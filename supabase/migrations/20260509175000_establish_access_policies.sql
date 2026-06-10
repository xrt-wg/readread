create or replace function public.is_current_user_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
    from public.admin_roles ar
    where ar.user_id = auth.uid()
      and ar.role = 'admin'
      and ar.revoked_at is null
  );
end;
$$;

grant execute on function public.is_current_user_admin() to authenticated;

drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin"
on public.profiles
for select
to authenticated
using (public.is_current_user_admin());

drop policy if exists "featured_articles_select_published" on public.featured_articles;
create policy "featured_articles_select_published"
on public.featured_articles
for select
to anon, authenticated
using (status = 'published' and deleted_at is null);

drop policy if exists "featured_articles_select_admin" on public.featured_articles;
create policy "featured_articles_select_admin"
on public.featured_articles
for select
to authenticated
using (public.is_current_user_admin());

drop policy if exists "featured_articles_insert_admin" on public.featured_articles;
create policy "featured_articles_insert_admin"
on public.featured_articles
for insert
to authenticated
with check (public.is_current_user_admin());

drop policy if exists "featured_articles_update_admin" on public.featured_articles;
create policy "featured_articles_update_admin"
on public.featured_articles
for update
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

drop policy if exists "admin_roles_select_own_active" on public.admin_roles;
create policy "admin_roles_select_own_active"
on public.admin_roles
for select
to authenticated
using (auth.uid() = user_id and revoked_at is null);

drop policy if exists "audit_logs_select_admin" on public.audit_logs;
create policy "audit_logs_select_admin"
on public.audit_logs
for select
to authenticated
using (public.is_current_user_admin());

grant select, update on public.profiles to authenticated;
grant select on public.featured_articles to anon, authenticated;
grant insert, update on public.featured_articles to authenticated;
grant select on public.admin_roles to authenticated;
grant select on public.audit_logs to authenticated;
