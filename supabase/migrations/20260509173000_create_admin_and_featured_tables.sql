create table if not exists public.featured_articles (
  id text primary key,
  title text not null,
  source text,
  description text,
  text text not null,
  markdown text,
  cover_image_url text,
  status text not null default 'published' check (status in ('draft', 'published', 'archived')),
  sort_order integer not null default 0,
  published_at timestamptz,
  created_by uuid references public.profiles (user_id) on delete set null,
  updated_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz
);

create table if not exists public.admin_roles (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  role text not null default 'admin' check (role in ('admin')),
  granted_by uuid references public.profiles (user_id) on delete set null,
  granted_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.audit_logs (
  id bigserial primary key,
  actor_user_id uuid references public.profiles (user_id) on delete set null,
  actor_role text,
  action text not null,
  target_type text not null,
  target_id text,
  payload jsonb,
  ip_address text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_featured_articles_status_sort_order
on public.featured_articles (status, sort_order);

create index if not exists idx_admin_roles_role_revoked_at
on public.admin_roles (role, revoked_at);

create index if not exists idx_audit_logs_actor_user_id_created_at
on public.audit_logs (actor_user_id, created_at desc);

create index if not exists idx_audit_logs_target_type_target_id
on public.audit_logs (target_type, target_id);

create index if not exists idx_audit_logs_action_created_at
on public.audit_logs (action, created_at desc);

drop trigger if exists trg_featured_articles_set_updated_at on public.featured_articles;
create trigger trg_featured_articles_set_updated_at
before update on public.featured_articles
for each row
execute function public.set_record_updated_at();

drop trigger if exists trg_admin_roles_set_updated_at on public.admin_roles;
create trigger trg_admin_roles_set_updated_at
before update on public.admin_roles
for each row
execute function public.set_record_updated_at();

create or replace function public.prevent_audit_logs_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;

drop trigger if exists trg_audit_logs_no_update on public.audit_logs;
create trigger trg_audit_logs_no_update
before update on public.audit_logs
for each row
execute function public.prevent_audit_logs_mutation();

drop trigger if exists trg_audit_logs_no_delete on public.audit_logs;
create trigger trg_audit_logs_no_delete
before delete on public.audit_logs
for each row
execute function public.prevent_audit_logs_mutation();

alter table public.featured_articles enable row level security;
alter table public.admin_roles enable row level security;
alter table public.audit_logs enable row level security;
