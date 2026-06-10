drop policy if exists "audit_logs_insert_admin" on public.audit_logs;
create policy "audit_logs_insert_admin"
on public.audit_logs
for insert
to authenticated
with check (
  public.is_current_user_admin()
  and actor_user_id = auth.uid()
  and actor_role = 'admin'
);

grant insert on public.audit_logs to authenticated;
