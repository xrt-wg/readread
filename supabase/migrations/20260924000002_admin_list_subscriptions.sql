-- 管理员侧：一次性读取所有用户的订阅身份与额度余量（后台「用户基础信息」页展示）
-- 口径与 get_subscription_status 同源：周滚动（Asia/Shanghai 周一 0 点）；Pro 不显 Free 额度（额度是 Free 专属约束）
begin;

create function public.admin_list_user_subscriptions() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_import_limit   integer;
  v_bookmark_limit integer;
  v_cur_week       timestamptz := date_trunc('week', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai';
  v_rows           jsonb;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;

  select coalesce(import_free_limit, 30), coalesce(bookmark_week_limit, 30)
    into v_import_limit, v_bookmark_limit
    from public.subscription_config where id = true;

  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', u.id,
    'plan', case when s.pro_expires_at > now() then 'pro' else 'free' end,
    'proExpiresAt', case when s.pro_expires_at > now() then s.pro_expires_at else null end,
    'importRemaining', case when s.pro_expires_at > now() then null
                            else greatest(0, v_import_limit - coalesce(q.import_lifetime_count, 0)) end,
    'bookmarkRemaining', case when s.pro_expires_at > now() then null
                              else greatest(0, v_bookmark_limit - case when q.bookmark_week_start = v_cur_week
                                                                      then coalesce(q.bookmark_week_count, 0) else 0 end) end
  ) order by u.created_at desc), '[]'::jsonb)
  into v_rows
  from auth.users u
  left join public.subscriptions s on s.user_id = u.id
  left join public.user_quotas    q on q.user_id = u.id;

  return v_rows;
end; $$;

revoke all on function public.admin_list_user_subscriptions() from public, anon, authenticated;
grant execute on function public.admin_list_user_subscriptions() to authenticated;

notify pgrst, 'reload schema';
commit;
