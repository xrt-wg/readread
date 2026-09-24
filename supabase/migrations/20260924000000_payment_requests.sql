-- 付费开通请求（验证期：扫码支付 + 管理员人工核对到账后发放）
-- 定位：支付回调未接入前，「贴收款码 → 用户点击已支付 → 管理员确认发放」的轻量闭环。
-- 发放写 source='paid'（区别于 admin 人工授予 / contribution 社区奖励），external_ref 复用 pro_grants 预留的支付幂等键。
begin;

-- ─── 1. 付费申请台账 ───────────────────────────────────────────────────────────

create table public.payment_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  amount_cents    integer not null default 990,          -- 验证期固定 ¥9.9
  requested_days  integer not null default 30,           -- 验证期固定 30 天
  status          text not null default 'pending' check (status in ('pending','granted','rejected')),
  created_at      timestamptz not null default now(),
  granted_by      uuid references auth.users(id),
  granted_at      timestamptz,
  rejected_reason  text
);

create index payment_requests_user_idx on public.payment_requests(user_id, created_at desc);
-- 同一用户至多一笔待处理申请（防重复建单 / 竞态兜底）
create unique index uq_payment_requests_open on public.payment_requests(user_id) where status = 'pending';

-- ─── 2. RLS（全 revoke，读写均经 security definer RPC）─────────────────────────

alter table public.payment_requests enable row level security;
revoke all on public.payment_requests from anon, authenticated;

-- ─── 3. 用户侧 RPC ─────────────────────────────────────────────────────────────

-- 提交申请（幂等：已存在 pending 则复用，不重复建单）
create function public.submit_payment_request() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_existing public.payment_requests%rowtype;
begin
  if v_user is null then raise exception '未登录'; end if;
  insert into public.payment_requests(user_id) values (v_user) on conflict do nothing;
  select * into v_existing from public.payment_requests
   where user_id = v_user and status = 'pending' order by created_at desc limit 1;
  return jsonb_build_object('id', v_existing.id, 'status', 'pending',
    'amountCents', v_existing.amount_cents, 'requestedDays', v_existing.requested_days,
    'createdAt', v_existing.created_at);
end; $$;

-- 查询自己最近一笔申请（展示「待确认 / 已开通 / 已拒绝」），无则 null
create function public.get_my_payment_request() returns jsonb
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
    'createdAt', v_row.created_at, 'rejectedReason', v_row.rejected_reason);
end; $$;

-- ─── 4. 管理员侧 RPC ───────────────────────────────────────────────────────────

-- 待发放队列（含用户邮箱，便于核对到账）
create function public.admin_list_payment_requests() returns jsonb
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

-- 确认发放：锁行 → 累加 Pro 时长（source='paid'）→ 置 granted → 记审计
create function public.admin_confirm_payment(p_request_id uuid, p_days integer default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req  public.payment_requests%rowtype;
  v_days integer;
  v_pro  timestamptz;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  select * into v_req from public.payment_requests where id = p_request_id for update;
  if not found then raise exception '申请不存在'; end if;
  if v_req.status <> 'pending' then raise exception '该申请已处理'; end if;
  v_days := coalesce(p_days, v_req.requested_days);
  if v_days is null or v_days <= 0 then raise exception '天数必须为正整数'; end if;
  insert into public.subscriptions(user_id) values (v_req.user_id) on conflict (user_id) do nothing;
  update public.subscriptions
     set pro_expires_at = greatest(now(), coalesce(pro_expires_at, now())) + (v_days || ' days')::interval,
         pro_source = 'paid', updated_at = now()
   where user_id = v_req.user_id
   returning pro_expires_at into v_pro;
  insert into public.pro_grants(user_id, source, days, external_ref, granted_by)
    values (v_req.user_id, 'paid', v_days, p_request_id::text, auth.uid());
  insert into public.audit_logs(actor_user_id, actor_role, action, target_type, target_id, payload)
    values (auth.uid(), 'admin', 'subscription.payment_granted', 'payment_request', p_request_id::text,
            jsonb_build_object('user_id', v_req.user_id, 'days', v_days));
  update public.payment_requests set status = 'granted', granted_by = auth.uid(), granted_at = now()
   where id = p_request_id;
  return jsonb_build_object('userId', v_req.user_id, 'days', v_days, 'proExpiresAt', v_pro);
end; $$;

-- 拒绝申请（验证期软处理：置 rejected + 原因）
create function public.admin_reject_payment(p_request_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_req public.payment_requests%rowtype;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  select * into v_req from public.payment_requests where id = p_request_id for update;
  if not found then raise exception '申请不存在'; end if;
  if v_req.status <> 'pending' then raise exception '该申请已处理'; end if;
  update public.payment_requests set status = 'rejected', rejected_reason = coalesce(p_reason, '')
   where id = p_request_id;
  insert into public.audit_logs(actor_user_id, actor_role, action, target_type, target_id, payload)
    values (auth.uid(), 'admin', 'subscription.payment_rejected', 'payment_request', p_request_id::text,
            jsonb_build_object('user_id', v_req.user_id, 'reason', p_reason));
end; $$;

-- ─── 5. 授权与刷新 ─────────────────────────────────────────────────────────────

revoke all on function public.submit_payment_request() from public, anon, authenticated;
revoke all on function public.get_my_payment_request() from public, anon, authenticated;
revoke all on function public.admin_list_payment_requests() from public, anon, authenticated;
revoke all on function public.admin_confirm_payment(uuid, integer) from public, anon, authenticated;
revoke all on function public.admin_reject_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.submit_payment_request() to authenticated;
grant execute on function public.get_my_payment_request() to authenticated;
grant execute on function public.admin_list_payment_requests() to authenticated;
grant execute on function public.admin_confirm_payment(uuid, integer) to authenticated;
grant execute on function public.admin_reject_payment(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
