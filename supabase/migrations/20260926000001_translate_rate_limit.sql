-- S2：翻译接口鉴权限流 —— 计数表 + 单行配置表 + 原子递增 RPC + 后台可调阈值
-- 定位：translate.js LLM 路径按 sub 每用户限流、直译路径按 IP 限流；计数与阈值落 Supabase（可后台配置），函数以 service_role 直连调用。
-- 依赖：20260923000000_subscription_mechanism.sql（audit_logs + is_current_user_admin）。
begin;

-- ─── 1. 计数表 ──────────────────────────────────────────────────────────────────

create table public.translate_rate_limits (
  scope        text not null check (scope in ('user','ip')),
  scope_id     text not null,
  window_start timestamptz not null default now(),
  count        integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (scope, scope_id)
);

-- ─── 2. 单行配置表（阈值可后台调，改配置即时生效，无需重部署函数）─────────────

create table public.translate_rate_limit_config (
  id                  boolean primary key default true check (id),
  llm_per_user_limit  integer not null default 20   check (llm_per_user_limit between 1 and 10000),
  llm_window_hours    integer not null default 1    check (llm_window_hours between 1 and 720),
  direct_per_ip_limit integer not null default 60   check (direct_per_ip_limit between 1 and 100000),
  direct_window_hours integer not null default 1    check (direct_window_hours between 1 and 720),
  updated_at          timestamptz not null default now()
);

insert into public.translate_rate_limit_config (id) values (true) on conflict (id) do nothing;

-- ─── 3. RLS（全 revoke，读写均经 security definer RPC / service_role）───────────

alter table public.translate_rate_limits enable row level security;
alter table public.translate_rate_limit_config enable row level security;
revoke all on public.translate_rate_limits from anon, authenticated;
revoke all on public.translate_rate_limit_config from anon, authenticated;

-- ─── 4. 计数 RPC（仅 service_role 可调）─────────────────────────────────────────

-- 原子固定窗口递增：单条 insert on conflict do update，窗口起点过期则重置为 1；阈值每次调用从配置表读。
create function public.consume_translate_quota(p_scope text, p_scope_id text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_limit          integer;
  v_window_hours   integer;
  v_window_seconds integer;
  v_count          integer;
  v_window_start   timestamptz;
begin
  if p_scope not in ('user','ip') then raise exception '未知限流范围'; end if;
  if p_kind = 'llm' then
    select coalesce(llm_per_user_limit, 20), coalesce(llm_window_hours, 1) into v_limit, v_window_hours
      from public.translate_rate_limit_config where id = true;
  elsif p_kind = 'direct' then
    select coalesce(direct_per_ip_limit, 60), coalesce(direct_window_hours, 1) into v_limit, v_window_hours
      from public.translate_rate_limit_config where id = true;
  else
    raise exception '未知限流类型';
  end if;
  v_window_seconds := v_window_hours * 3600;

  insert into public.translate_rate_limits(scope, scope_id, window_start, count)
    values (p_scope, p_scope_id, now(), 1)
    on conflict (scope, scope_id) do update set
      count = case when public.translate_rate_limits.window_start <= now() - make_interval(secs => v_window_seconds)
                   then 1 else public.translate_rate_limits.count + 1 end,
      window_start = case when public.translate_rate_limits.window_start <= now() - make_interval(secs => v_window_seconds)
                   then now() else public.translate_rate_limits.window_start end,
      updated_at = now()
    returning count, window_start into v_count, v_window_start;

  return jsonb_build_object(
    'allowed', v_count <= v_limit,
    'used', v_count,
    'limit', v_limit,
    'windowSeconds', v_window_seconds,
    'resetAt', v_window_start + make_interval(secs => v_window_seconds));
end; $$;

-- ─── 5. 后台配置 RPC（沿用 recommendation_submission_config 乐观并发 + 审计）───

create function public.admin_get_translate_rate_limit_config() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cfg public.translate_rate_limit_config%rowtype;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  select * into v_cfg from public.translate_rate_limit_config where id = true;
  return jsonb_build_object(
    'llmPerUserLimit', v_cfg.llm_per_user_limit,
    'llmWindowHours', v_cfg.llm_window_hours,
    'directPerIpLimit', v_cfg.direct_per_ip_limit,
    'directWindowHours', v_cfg.direct_window_hours,
    'updatedAt', v_cfg.updated_at);
end; $$;

create function public.admin_save_translate_rate_limit_config(
  p_llm_per_user_limit integer,
  p_llm_window_hours integer,
  p_direct_per_ip_limit integer,
  p_direct_window_hours integer,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cfg public.translate_rate_limit_config%rowtype;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  select * into v_cfg from public.translate_rate_limit_config where id = true for update;
  if p_expected_updated_at is null or v_cfg.updated_at is distinct from p_expected_updated_at then
    raise exception '配置已被其他管理员修改，请重新加载后再保存';
  end if;
  if p_llm_per_user_limit < 1 or p_llm_window_hours < 1 or p_direct_per_ip_limit < 1 or p_direct_window_hours < 1 then
    raise exception '限流阈值须为正整数';
  end if;
  update public.translate_rate_limit_config
     set llm_per_user_limit = p_llm_per_user_limit,
         llm_window_hours = p_llm_window_hours,
         direct_per_ip_limit = p_direct_per_ip_limit,
         direct_window_hours = p_direct_window_hours,
         updated_at = clock_timestamp()
   where id = true;
  insert into public.audit_logs(actor_user_id, actor_role, action, target_type, target_id, payload)
    values (auth.uid(), 'admin', 'translate.rate_limit_config_updated', 'translate_rate_limit_config', 'true',
            jsonb_build_object(
              'before', jsonb_build_object(
                'llmPerUserLimit', v_cfg.llm_per_user_limit, 'llmWindowHours', v_cfg.llm_window_hours,
                'directPerIpLimit', v_cfg.direct_per_ip_limit, 'directWindowHours', v_cfg.direct_window_hours),
              'after', jsonb_build_object(
                'llmPerUserLimit', p_llm_per_user_limit, 'llmWindowHours', p_llm_window_hours,
                'directPerIpLimit', p_direct_per_ip_limit, 'directWindowHours', p_direct_window_hours)));
  return public.admin_get_translate_rate_limit_config();
end; $$;

-- ─── 6. 授权与刷新 ─────────────────────────────────────────────────────────────

-- consume_translate_quota 仅 service_role 可调（revoke public 后显式 grant service_role）
revoke all on function public.consume_translate_quota(text, text, text) from public, anon, authenticated;
grant execute on function public.consume_translate_quota(text, text, text) to service_role;

-- 后台配置 RPC 走 authenticated（admin 闸门内再校验）
revoke all on function public.admin_get_translate_rate_limit_config() from public, anon, authenticated;
revoke all on function public.admin_save_translate_rate_limit_config(integer, integer, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_get_translate_rate_limit_config() to authenticated;
grant execute on function public.admin_save_translate_rate_limit_config(integer, integer, integer, integer, timestamptz) to authenticated;

notify pgrst, 'reload schema';
commit;
