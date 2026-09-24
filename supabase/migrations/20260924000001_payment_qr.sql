-- 付费收款码配置：管理员后台上传（存 data URL，验证期不引入 Storage）
-- 账号面板免费用户区展示；管理员在「付费发放」页上传/替换/清除。
begin;

alter table public.subscription_config
  add column if not exists payment_qr_data_url text;

-- 读取收款码（登录用户可见，账号面板展示用）
create function public.get_payment_qr() returns text
language plpgsql security definer set search_path = public as $$
declare v_qr text;
begin
  select payment_qr_data_url into v_qr from public.subscription_config where id = true;
  return v_qr;
end; $$;

-- 管理员设置/清除收款码（空串或 null 清除）
create function public.admin_set_payment_qr(p_qr_data_url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  if p_qr_data_url is not null and p_qr_data_url <> '' and p_qr_data_url not like 'data:image/%' then
    raise exception '仅支持图片（data:image）'; end if;
  update public.subscription_config
     set payment_qr_data_url = nullif(p_qr_data_url, ''), updated_at = now()
   where id = true;
  insert into public.audit_logs(actor_user_id, actor_role, action, target_type, target_id, payload)
    values (auth.uid(), 'admin', 'subscription.payment_qr_updated', 'subscription_config', 'payment_qr',
            jsonb_build_object('updated', p_qr_data_url is not null and p_qr_data_url <> ''));
end; $$;

revoke all on function public.get_payment_qr() from public, anon, authenticated;
revoke all on function public.admin_set_payment_qr(text) from public, anon, authenticated;
grant execute on function public.get_payment_qr() to authenticated;
grant execute on function public.admin_set_payment_qr(text) to authenticated;

notify pgrst, 'reload schema';
commit;
