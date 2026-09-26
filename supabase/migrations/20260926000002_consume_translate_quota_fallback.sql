-- S2 补丁：consume_translate_quota 配置行缺失兜底（实施后审核 O4）
-- 问题：原实现 select coalesce(...) 只兜 NULL 列值，兜不住「translate_rate_limit_config 单行被删」；
--   此时 v_limit/v_window_hours 为 NULL → 窗口永不重置 → allowed=NULL → translate.js 判 false → LLM 放行（fail-closed 反向失效）。
-- 修复：去掉冗余 coalesce（列本身 not null default），改 if not found 显式兜底默认值，使「兜底默认」名副其实。
-- 说明：create or replace 保留 20260926000001 已授予的 service_role 执行权，无需重复 revoke/grant。
begin;

create or replace function public.consume_translate_quota(p_scope text, p_scope_id text, p_kind text) returns jsonb
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
    select llm_per_user_limit, llm_window_hours into v_limit, v_window_hours
      from public.translate_rate_limit_config where id = true;
    if not found then v_limit := 20; v_window_hours := 1; end if;
  elsif p_kind = 'direct' then
    select direct_per_ip_limit, direct_window_hours into v_limit, v_window_hours
      from public.translate_rate_limit_config where id = true;
    if not found then v_limit := 60; v_window_hours := 1; end if;
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

notify pgrst, 'reload schema';
commit;
