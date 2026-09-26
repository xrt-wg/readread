-- S1：付费核对加固 —— 三列 + 核对码 partial unique index + 三层限流 RPC + 发码即建单
-- 依赖：20260924000000_payment_requests.sql（payment_requests 表 + submit/get_my/admin_list/admin_confirm/admin_reject）
-- 定位：验证期人工核对闭环的防滥用与可追溯加固，不改订阅机制本身、不动 pro_grants 账本语义、不动 uq_payment_requests_open。
begin;

-- ─── 1. 数据模型变更 ───────────────────────────────────────────────────────────

-- verification_code：4 位核对码（打开弹窗即发码，支付备注填码，服务端定位孤儿支付）
-- claimed_at：NULL = 发码未提交，非 NULL = 已提交（仅作区分标记，不改变 status 三态枚举）
-- cooldown_until：拒绝后冷却截止时间（24h），冷却期内 begin/submit 均拦截
alter table public.payment_requests
  add column verification_code text,
  add column claimed_at timestamptz,
  add column cooldown_until timestamptz;

-- 核对码在 pending 单中全局唯一（4 位码、万空间，约百笔活跃单时碰撞概率已近 50%，必须索引兜底而非无锁 SELECT-then-INSERT）
create unique index uq_payment_requests_open_code on public.payment_requests(verification_code) where status = 'pending';

-- 存量 pending 行回填：旧语义下 pending 均视为「已提交」，消除列语义回归（不误判为「发码未提交」）
update public.payment_requests set claimed_at = created_at where status = 'pending' and claimed_at is null;

-- ─── 2. 内部辅助：建单 + 发码（含核对码撞码重生成）─────────────────────────────

-- 生成 4 位码并插入 open 单；核对码撞码（on conflict do nothing）或同用户竞态建单时幂等复用，仅内部调用。
create function public._create_pending_with_code(p_user uuid, p_claimed_at timestamptz) returns public.payment_requests
language plpgsql security definer set search_path = public as $$
declare
  v_row      public.payment_requests%rowtype;
  v_code     text;
  v_attempts integer := 0;
begin
  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 50 then raise exception '核对码生成失败，请稍后重试'; end if;
    v_code := lpad(floor(random() * 10000)::int::text, 4, '0');
    insert into public.payment_requests(user_id, verification_code, claimed_at)
      values (p_user, v_code, p_claimed_at)
      on conflict do nothing
      returning * into v_row;
    if found then
      return v_row;
    end if;
    -- 未插入：同用户已存在 open 单（竞态）则复用，否则为核对码撞码则重试
    select * into v_row from public.payment_requests
     where user_id = p_user and status = 'pending' order by created_at desc limit 1;
    if found then
      return v_row;
    end if;
  end loop;
end; $$;

-- ─── 3. 用户侧 RPC ─────────────────────────────────────────────────────────────

-- 打开支付弹窗即建单发码（claimed_at=NULL，「发码未提交」）；已有 open 单幂等复用同一码；冷却期返回 { cooldownUntil }。
create function public.begin_payment_request() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_cd   timestamptz;
  v_row  public.payment_requests%rowtype;
begin
  if v_user is null then raise exception '未登录'; end if;
  -- 冷却拦截：读该用户最近 rejected 行的 cooldown_until（而非当前 pending 行，否则冷却形同虚设）
  select max(cooldown_until) into v_cd from public.payment_requests
   where user_id = v_user and cooldown_until > now();
  if v_cd is not null then
    return jsonb_build_object('cooldownUntil', v_cd);
  end if;
  -- 已有 open 单 → 幂等复用同一码，不新建、不重新生成
  select * into v_row from public.payment_requests
   where user_id = v_user and status = 'pending' order by created_at desc limit 1;
  if found then
    return jsonb_build_object('id', v_row.id, 'status', v_row.status,
      'amountCents', v_row.amount_cents, 'requestedDays', v_row.requested_days,
      'verificationCode', v_row.verification_code, 'claimedAt', v_row.claimed_at,
      'cooldownUntil', v_row.cooldown_until);
  end if;
  -- 新建 open 单 + 发码
  v_row := public._create_pending_with_code(v_user, null);
  return jsonb_build_object('id', v_row.id, 'status', v_row.status,
    'amountCents', v_row.amount_cents, 'requestedDays', v_row.requested_days,
    'verificationCode', v_row.verification_code, 'claimedAt', v_row.claimed_at,
    'cooldownUntil', v_row.cooldown_until);
end; $$;

-- 提交「我已支付」：置 claimed_at（幂等，重复提交不重置换）；被直调无 open 单时自建单并补码。
create or replace function public.submit_payment_request() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_cd   timestamptz;
  v_row  public.payment_requests%rowtype;
begin
  if v_user is null then raise exception '未登录'; end if;
  -- 冷却拦截（同 begin）
  select max(cooldown_until) into v_cd from public.payment_requests
   where user_id = v_user and cooldown_until > now();
  if v_cd is not null then raise exception '冷却期内暂不可申请，请稍后再试'; end if;
  -- 已有 open 单（begin 已建）→ 置 claimed_at
  select * into v_row from public.payment_requests
   where user_id = v_user and status = 'pending' order by created_at desc limit 1;
  if found then
    update public.payment_requests set claimed_at = coalesce(claimed_at, now())
     where id = v_row.id;
    select * into v_row from public.payment_requests where id = v_row.id;
    return jsonb_build_object('id', v_row.id, 'status', v_row.status,
      'amountCents', v_row.amount_cents, 'requestedDays', v_row.requested_days,
      'verificationCode', v_row.verification_code, 'claimedAt', v_row.claimed_at,
      'cooldownUntil', v_row.cooldown_until);
  end if;
  -- 直调（无 open 单）→ 自建单 + 补码 + 置 claimed_at（杜绝 verification_code=NULL 坏单）
  v_row := public._create_pending_with_code(v_user, now());
  return jsonb_build_object('id', v_row.id, 'status', v_row.status,
    'amountCents', v_row.amount_cents, 'requestedDays', v_row.requested_days,
    'verificationCode', v_row.verification_code, 'claimedAt', v_row.claimed_at,
    'cooldownUntil', v_row.cooldown_until);
end; $$;

-- 查询自己最近一笔申请（展示「发码未提交 / 已提交 / 已开通 / 已拒绝」），无则 null
create or replace function public.get_my_payment_request() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_row  public.payment_requests%rowtype;
begin
  if v_user is null then return null; end if;
  select * into v_row from public.payment_requests
   where user_id = v_user order by created_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status,
    'amountCents', v_row.amount_cents, 'requestedDays', v_row.requested_days,
    'verificationCode', v_row.verification_code, 'claimedAt', v_row.claimed_at,
    'cooldownUntil', v_row.cooldown_until,
    'createdAt', v_row.created_at, 'rejectedReason', v_row.rejected_reason);
end; $$;

-- ─── 4. 管理员侧 RPC ───────────────────────────────────────────────────────────

-- 待发放队列（含用户邮箱 + 核对码 + claimed_at + cooldown_until，便于核对到账）
create or replace function public.admin_list_payment_requests() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pr.id,
    'userId', pr.user_id,
    'email', u.email,
    'amountCents', pr.amount_cents,
    'requestedDays', pr.requested_days,
    'verificationCode', pr.verification_code,
    'claimedAt', pr.claimed_at,
    'cooldownUntil', pr.cooldown_until,
    'status', pr.status,
    'createdAt', pr.created_at,
    'grantedAt', pr.granted_at,
    'rejectedReason', pr.rejected_reason
  ) order by pr.created_at desc), '[]'::jsonb)
  into v_rows
  from public.payment_requests pr
  left join auth.users u on u.id = pr.user_id;
  return v_rows;
end; $$;

-- 拒绝申请：置 rejected + 原因 + 冷却（24h，可经 admin_reopen_payment 复位）
create or replace function public.admin_reject_payment(p_request_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_req public.payment_requests%rowtype;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  select * into v_req from public.payment_requests where id = p_request_id for update;
  if not found then raise exception '申请不存在'; end if;
  if v_req.status <> 'pending' then raise exception '该申请已处理'; end if;
  update public.payment_requests
     set status = 'rejected', rejected_reason = coalesce(p_reason, ''),
         cooldown_until = now() + interval '24 hours'
   where id = p_request_id;
  insert into public.audit_logs(actor_user_id, actor_role, action, target_type, target_id, payload)
    values (auth.uid(), 'admin', 'subscription.payment_rejected', 'payment_request', p_request_id::text,
            jsonb_build_object('user_id', v_req.user_id, 'reason', p_reason));
end; $$;

-- 复位冷却：只清 cooldown_until、不翻 status（用户重开弹窗自然走 begin 拿新码，且避免与核对码 partial unique index 撞唯一）+ 记审计
create function public.admin_reopen_payment(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_req public.payment_requests%rowtype;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  select * into v_req from public.payment_requests where id = p_request_id for update;
  if not found then raise exception '申请不存在'; end if;
  if v_req.cooldown_until is null then raise exception '该申请不在冷却期，无需复位'; end if;
  update public.payment_requests set cooldown_until = null where id = p_request_id;
  insert into public.audit_logs(actor_user_id, actor_role, action, target_type, target_id, payload)
    values (auth.uid(), 'admin', 'subscription.payment_reopened', 'payment_request', p_request_id::text,
            jsonb_build_object('user_id', v_req.user_id));
end; $$;

-- ─── 5. 授权与刷新 ─────────────────────────────────────────────────────────────
-- 注：submit/get_my/admin_list/admin_reject 为 create or replace，既有的 authenticated 授权保持不变；
-- 仅新函数需 revoke（默认 execute 授 PUBLIC）后按需 grant。

revoke all on function public._create_pending_with_code(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.begin_payment_request() from public, anon, authenticated;
revoke all on function public.admin_reopen_payment(uuid) from public, anon, authenticated;

grant execute on function public.begin_payment_request() to authenticated;
grant execute on function public.admin_reopen_payment(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
