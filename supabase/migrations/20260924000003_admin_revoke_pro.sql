-- 管理员侧：撤销指定用户的 Pro，恢复为 Free（仅清身份，额度计数与发放账本保留）
-- 用途：反复测试 free→pro 开通链路，无需新建用户；与 admin_grant_pro 对称。
-- 口径同订阅机制：身份是派生值 pro_expires_at > now()，置空即判定为 free。
begin;

create function public.admin_revoke_pro(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prev timestamptz;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  if not exists (select 1 from auth.users where id = p_user_id) then raise exception '用户不存在'; end if;

  insert into public.subscriptions(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select pro_expires_at into v_prev from public.subscriptions where user_id = p_user_id;
  update public.subscriptions
     set pro_expires_at = null,
         pro_source      = null,
         updated_at      = now()
   where user_id = p_user_id;

  insert into public.audit_logs(actor_user_id, actor_role, action, target_type, target_id, payload)
    values (auth.uid(), 'admin', 'subscription.pro_revoked', 'profile', p_user_id::text,
            jsonb_build_object('prev_pro_expires_at', v_prev));
  return jsonb_build_object('userId', p_user_id, 'plan', 'free', 'proExpiresAt', null);
end; $$;

revoke all on function public.admin_revoke_pro(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_pro(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
