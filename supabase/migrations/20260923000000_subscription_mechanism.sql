-- 订阅机制：Free/Pro 两身份 + 两个额度杠杆（导入终身累计 / 收藏每周软限）
-- 无支付接入；Pro 来源：社区贡献（上架换时长）+ 管理员人工授予
-- 身份 = 派生值：pro_expires_at > now()（不存枚举列）
begin;

-- ─── 1. 新表 ──────────────────────────────────────────────────────────────────

-- 订阅状态（权威）：身份由 pro_expires_at 派生
create table public.subscriptions (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  pro_expires_at  timestamptz,
  pro_source      text,           -- 'paid' | 'contribution' | 'admin'（最近一次来源，仅展示）
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 只增账本：社区贡献幂等 + 月度上限求和 + 审计（未来付费的 entitlement 来源）
create table public.pro_grants (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  source         text not null check (source in ('paid','contribution','admin')),
  days           integer not null check (days > 0),
  granted_at     timestamptz not null default now(),
  submission_id  text,            -- 贡献幂等键（同一篇上架只奖一次）
  external_ref   text,            -- 支付幂等键（未来 webhook 防重放，预留）
  granted_by     uuid
);
-- 幂等：一篇 submission 至多奖励一次
create unique index uq_pro_grants_submission
  on public.pro_grants(submission_id) where submission_id is not null;

-- 额度计数器（单调）：导入终身 + 收藏每周
create table public.user_quotas (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  import_lifetime_count integer not null default 0,
  bookmark_week_start   timestamptz,      -- 当前计费周起点（Asia/Shanghai 周一 0 点）
  bookmark_week_count   integer not null default 0,
  updated_at            timestamptz not null default now()
);

-- 单行配置：B 档参数后台可调
create table public.subscription_config (
  id                            boolean primary key default true check (id),
  import_free_limit             integer not null default 30,
  bookmark_week_limit           integer not null default 30,
  contribution_days_per_publish integer not null default 30,
  contribution_monthly_cap_days integer not null default 60,
  pro_weekly_limit              integer,           -- 预留：Pro 公平使用上限，null=无限（本次不启用）
  updated_at                    timestamptz not null default now()
);
insert into public.subscription_config(id) values (true) on conflict do nothing;

-- ─── 2. RLS 与授权（新表全 revoke，只留 own select）──────────────────────────────

alter table public.subscriptions      enable row level security;
alter table public.pro_grants         enable row level security;
alter table public.user_quotas        enable row level security;
alter table public.subscription_config enable row level security;

revoke all on public.subscriptions      from anon, authenticated;
revoke all on public.pro_grants         from anon, authenticated;
revoke all on public.user_quotas        from anon, authenticated;
revoke all on public.subscription_config from anon, authenticated;

grant select on public.subscriptions to authenticated;
grant select on public.user_quotas   to authenticated;

create policy subscriptions_own on public.subscriptions for select to authenticated using (user_id = auth.uid());
create policy user_quotas_own     on public.user_quotas    for select to authenticated using (user_id = auth.uid());

-- ─── 3. 加判别列 ────────────────────────────────────────────────────────────────

-- quota_consumed 仅对新增写路径有意义（触发器只读 new.quota_consumed）；存量行该列为 false，
-- 其额度语义由 §4 回填计数承载，二者双轨、不冲突。
alter table public.readings  add column if not exists quota_consumed boolean not null default false;
alter table public.bookmarks add column if not exists quota_consumed boolean not null default false;

-- ─── 4. 存量回填 ────────────────────────────────────────────────────────────────

-- 订阅：全员 Free（无到期）
insert into public.subscriptions(user_id)
select id from auth.users on conflict do nothing;

-- 导入终身计数：自导入 + 推荐加入（排除首次阅读 offer），含软删行（A2 不释放）。
-- origin='manual'（历史迁移残留）/ 'shared'（已废弃、无写路径）不计入。
insert into public.user_quotas(user_id, import_lifetime_count)
select u.id, count(r.id)
from auth.users u
left join public.readings r on r.user_id = u.id
  and (
    r.origin = 'imported'
    or (r.origin in ('featured','featured_legacy') and r.share_source_id is not null
        and r.id not in (select selected_reading_id from public.user_first_reading_states
                          where selected_reading_id is not null))
  )
group by u.id
on conflict (user_id) do update set import_lifetime_count = excluded.import_lifetime_count;

-- ─── 5. 额度消耗辅助函数（security definer，仅触发器/服务端内部调用）────────────────

create function public.consume_import_quota(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_limit integer;
begin
  -- Pro 不占额度
  if exists (select 1 from public.subscriptions where user_id = p_user and pro_expires_at > now()) then return; end if;
  -- coalesce 兜底：配置行被误删时回退默认值，防额度静默失效
  select coalesce(import_free_limit, 30) into v_limit from public.subscription_config where id = true;
  insert into public.user_quotas(user_id) values (p_user) on conflict (user_id) do nothing;
  if (select import_lifetime_count from public.user_quotas where user_id = p_user) >= v_limit then
    raise exception '导入额度已用完（终身累计 % 篇），Pro 即将开放', v_limit using errcode = 'Q0001';
  end if;
  update public.user_quotas set import_lifetime_count = import_lifetime_count + 1, updated_at = now() where user_id = p_user;
end; $$;

-- 收藏额度（每周，Asia/Shanghai 周一 0 点重置）
create function public.consume_bookmark_quota(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_limit integer;
  v_week  timestamptz;
  v_count integer;
begin
  -- Pro 不占额度
  if exists (select 1 from public.subscriptions where user_id = p_user and pro_expires_at > now()) then return; end if;
  select coalesce(bookmark_week_limit, 30) into v_limit from public.subscription_config where id = true;
  v_week := date_trunc('week', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai';
  insert into public.user_quotas(user_id, bookmark_week_start, bookmark_week_count)
    values (p_user, v_week, 0) on conflict (user_id) do nothing;
  -- 同周递增、跨周置 1；同步更新周起点（漏改周起点会导致后续误判「仍在旧周」）
  update public.user_quotas
     set bookmark_week_count = case when bookmark_week_start = v_week then bookmark_week_count + 1 else 1 end,
         bookmark_week_start = v_week,
         updated_at = now()
   where user_id = p_user
   returning bookmark_week_count into v_count;
  if v_count > v_limit then
    raise exception '本周收藏额度已用完（每周 % 条，北京时间周一 0 点重置），Pro 即将开放', v_limit using errcode = 'Q0002';
  end if;
end; $$;

-- ─── 6. 社区贡献发 Pro（幂等 + 月上限）──────────────────────────────────────────

create function public.grant_contribution_pro(p_user_id uuid, p_submission_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_days       integer;
  v_cap        integer;
  v_used       integer;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai';
begin
  -- 纵深防御：无提交人（历史/管理员补录行）不发放奖励，避免 NULL user_id 违反 NOT NULL
  if p_user_id is null then return; end if;
  select coalesce(contribution_days_per_publish, 30), coalesce(contribution_monthly_cap_days, 60)
    into v_days, v_cap from public.subscription_config where id = true;
  select coalesce(sum(days), 0) into v_used from public.pro_grants
    where user_id = p_user_id and source = 'contribution' and granted_at >= v_month_start;
  if v_used >= v_cap then
    -- 撞月上限：作废、不顺延、记审计（内容照常上架，奖励不发）
    insert into public.audit_logs(actor_user_id, actor_role, action, target_type, target_id, payload)
      values (auth.uid(), 'admin', 'subscription.contribution_capped', 'recommendation_submission', p_submission_id,
              jsonb_build_object('user_id', p_user_id, 'days', v_days, 'month_used', v_used, 'cap', v_cap));
    return;
  end if;
  -- 幂等：同一篇只奖一次（重上架不会走到这里；此处为纵深防御，insert 冲突则跳过）
  insert into public.pro_grants(user_id, source, days, submission_id, granted_by)
    values (p_user_id, 'contribution', v_days, p_submission_id, auth.uid())
    on conflict do nothing;
  if not found then return; end if;
  insert into public.subscriptions(user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.subscriptions
     set pro_expires_at = greatest(now(), coalesce(pro_expires_at, now())) + (v_days || ' days')::interval,
         pro_source = 'contribution', updated_at = now()
   where user_id = p_user_id;
  insert into public.audit_logs(actor_user_id, actor_role, action, target_type, target_id, payload)
    values (auth.uid(), 'admin', 'subscription.contribution_granted', 'recommendation_submission', p_submission_id,
            jsonb_build_object('user_id', p_user_id, 'days', v_days));
end; $$;

-- ─── 7. 状态读取 RPC（前端统一消费）──────────────────────────────────────────────

create function public.get_subscription_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u          uuid := auth.uid();
  v_pro      timestamptz;
  v_import_used integer := 0;
  v_import_limit integer;
  v_bookmark_used integer := 0;
  v_bookmark_limit integer;
  v_week     timestamptz;
  v_cur_week timestamptz := date_trunc('week', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai';
begin
  if u is null then
    return jsonb_build_object('plan', 'free', 'proExpiresAt', null,
      'importUsed', 0, 'importLimit', null, 'bookmarkUsed', 0, 'bookmarkLimit', null, 'bookmarkWeekStart', null);
  end if;
  select pro_expires_at into v_pro from public.subscriptions where user_id = u;
  select coalesce(import_free_limit, 30), coalesce(bookmark_week_limit, 30)
    into v_import_limit, v_bookmark_limit from public.subscription_config where id = true;
  select coalesce(import_lifetime_count, 0), coalesce(bookmark_week_count, 0), bookmark_week_start
    into v_import_used, v_bookmark_used, v_week from public.user_quotas where user_id = u;
  -- 展示层周滚动：若已跨周，本周已用显示为 0（数据层在下次 consume 时纠正）
  if v_week is distinct from v_cur_week then
    v_bookmark_used := 0;
    v_week := v_cur_week;
  end if;
  -- coalesce 兜底「额度 0」：无 user_quotas 行的新注册用户，标量 select into 得 NULL（覆盖 := 0 初始化）
  return jsonb_build_object(
    'plan', case when v_pro is not null and v_pro > now() then 'pro' else 'free' end,
    'proExpiresAt', case when v_pro is not null and v_pro > now() then v_pro else null end,
    'importUsed', coalesce(v_import_used, 0),
    'importLimit', v_import_limit,
    'bookmarkUsed', coalesce(v_bookmark_used, 0),
    'bookmarkLimit', v_bookmark_limit,
    'bookmarkWeekStart', v_week);
end; $$;

-- ─── 8. 管理员人工授予 Pro（支付接入前唯一 Pro 发放路径）────────────────────────

create function public.admin_grant_pro(p_user_id uuid, p_days integer, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_pro timestamptz;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  if p_days is null or p_days <= 0 then raise exception '天数必须为正整数'; end if;
  if not exists (select 1 from auth.users where id = p_user_id) then raise exception '用户不存在'; end if;
  insert into public.subscriptions(user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.subscriptions
     set pro_expires_at = greatest(now(), coalesce(pro_expires_at, now())) + (p_days || ' days')::interval,
         pro_source = 'admin', updated_at = now()
   where user_id = p_user_id
   returning pro_expires_at into v_pro;
  insert into public.pro_grants(user_id, source, days, granted_by)
    values (p_user_id, 'admin', p_days, auth.uid());
  insert into public.audit_logs(actor_user_id, actor_role, action, target_type, target_id, payload)
    values (auth.uid(), 'admin', 'subscription.admin_grant', 'profile', p_user_id::text,
            jsonb_build_object('days', p_days, 'note', p_note));
  return jsonb_build_object('userId', p_user_id, 'proExpiresAt', v_pro);
end; $$;

-- ─── 9. 扩展写守护触发器（额度消耗）────────────────────────────────────────────

-- 插入位置固定：lock → 级联检查 → reading-limit → consume 两段 → 抑制插入 → return。
-- saveBookmark 是 upsert，翻译回写/重试即使最终落 UPDATE 也会先触发 tg_op='INSERT'，
-- 故叠加 not exists 真新增判定，避免正常回写静默多计。
create or replace function public.guard_reading_user_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if tg_op = 'DELETE' then v_user := old.user_id; else v_user := new.user_id; end if;
  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    raise exception 'Cannot transfer reading data between accounts';
  end if;
  perform public.lock_reading_user(v_user);
  -- Account deletion cascades must not recreate a state row referencing the deleted account.
  if tg_op = 'DELETE' and not exists(select 1 from auth.users where id=v_user) then return old; end if;
  if tg_table_name = 'readings' and tg_op <> 'DELETE' then
    if new.reading_status = 'reading' and new.deleted_at is null then
      if (select count(*) from public.readings where user_id = v_user and reading_status = 'reading'
          and deleted_at is null and id <> new.id) >= 5 then
        raise exception '阅读区已满（上限 5 本），可选择先取回再加入';
      end if;
    end if;
  end if;
  -- 额度消耗（真新增判定 + 判别键）
  if tg_table_name = 'readings' and tg_op = 'INSERT' and coalesce(new.quota_consumed, false)
     and not exists (select 1 from public.readings where id = new.id) then
    perform public.consume_import_quota(v_user);
  end if;
  if tg_table_name = 'bookmarks' and tg_op = 'INSERT' and coalesce(new.quota_consumed, false)
     and not exists (select 1 from public.bookmarks where id = new.id) then
    perform public.consume_bookmark_quota(v_user);
  end if;
  insert into public.user_first_reading_states(user_id, status, handled_at)
    values (v_user, 'suppressed', now())
    on conflict (user_id) do update set status = 'suppressed', handled_at = now(), updated_at = now()
      where user_first_reading_states.status = 'pending';
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- ─── 10. 扩展上架发布（首次上架发 Pro 奖励）────────────────────────────────────

-- 首次上架判定：先锁行读 first_published_at（coalesce(first_published_at,now()) returning 恒非 NULL，同事务无法区分）
create or replace function public.admin_publish_recommendation(p_submission_id text, p_internal_note text default null)
returns public.recommendation_submissions
language plpgsql security definer set search_path = public as $$
declare
  v_result public.recommendation_submissions%rowtype;
  v_first_published_at timestamptz;
  v_submitter uuid;
  v_is_first boolean;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  select first_published_at, submitter_user_id into v_first_published_at, v_submitter
    from public.recommendation_submissions where id = p_submission_id for update;
  if not found then raise exception '推荐内容不存在'; end if;
  v_is_first := v_first_published_at is null;
  update public.recommendation_submissions set status = 'active', first_published_at = coalesce(first_published_at, now()), published_at = now(), updated_at = now()
  where id = p_submission_id and status = 'approved' and length(trim(intro)) > 0 and cardinality(excerpts) between 1 and 5 returning * into v_result;
  if not found then raise exception '发布前需处于已通过状态，并填写推荐语及 1 至 5 条摘录'; end if;
  if v_is_first then
    perform public.grant_contribution_pro(v_submitter, p_submission_id);
  end if;
  insert into public.recommendation_submission_admin_reviews (submission_id, internal_note, reviewed_by, reviewed_at, updated_at)
  values (p_submission_id, p_internal_note, auth.uid(), now(), now()) on conflict (submission_id) do update set internal_note = excluded.internal_note, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at;
  insert into public.audit_logs (actor_user_id, actor_role, action, target_type, target_id) values (auth.uid(), 'admin', 'recommendation.published', 'recommendation_submission', p_submission_id);
  return v_result;
end; $$;

-- ─── 11. 授权与刷新 ─────────────────────────────────────────────────────────────

revoke all on function public.consume_import_quota(uuid), public.consume_bookmark_quota(uuid),
  public.grant_contribution_pro(uuid, text) from public, anon, authenticated;
grant execute on function public.get_subscription_status() to authenticated;
grant execute on function public.admin_grant_pro(uuid, integer, text) to authenticated;

notify pgrst, 'reload schema';
commit;
