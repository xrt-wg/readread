create table if not exists public.articles (
  id text primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  title text not null,
  text text not null,
  markdown text,
  word_count integer not null default 0 check (word_count >= 0),
  source_type text not null default 'manual',
  source_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  constraint articles_user_id_id_key unique (user_id, id)
);

create table if not exists public.bookmarks (
  id text primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  article_id text not null,
  type text not null check (type in ('word', 'phrase', 'sentence', 'paragraph')),
  text text not null,
  translation text,
  context_sentence text,
  context_translation text,
  translation_status text not null default 'pending',
  paragraph_index integer check (paragraph_index is null or paragraph_index >= 0),
  char_offset integer check (char_offset is null or char_offset >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  next_review_at timestamptz,
  familiarity smallint not null default 0 check (familiarity between 0 and 5),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  constraint bookmarks_user_article_fk foreign key (user_id, article_id)
    references public.articles (user_id, id) on delete cascade
);

create table if not exists public.reading_marks (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  article_id text not null,
  paragraph_index integer check (paragraph_index is null or paragraph_index >= 0),
  completed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, article_id),
  constraint reading_marks_user_article_fk foreign key (user_id, article_id)
    references public.articles (user_id, id) on delete cascade
);

create index if not exists idx_articles_user_id on public.articles (user_id);
create index if not exists idx_bookmarks_user_id on public.bookmarks (user_id);
create index if not exists idx_bookmarks_article_id on public.bookmarks (article_id);
create index if not exists idx_reading_marks_article_id on public.reading_marks (article_id);

create or replace function public.set_record_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_articles_set_updated_at on public.articles;
create trigger trg_articles_set_updated_at
before update on public.articles
for each row
execute function public.set_record_updated_at();

drop trigger if exists trg_bookmarks_set_updated_at on public.bookmarks;
create trigger trg_bookmarks_set_updated_at
before update on public.bookmarks
for each row
execute function public.set_record_updated_at();

drop trigger if exists trg_reading_marks_set_updated_at on public.reading_marks;
create trigger trg_reading_marks_set_updated_at
before update on public.reading_marks
for each row
execute function public.set_record_updated_at();

alter table public.articles enable row level security;
alter table public.bookmarks enable row level security;
alter table public.reading_marks enable row level security;

drop policy if exists "articles_select_own" on public.articles;
create policy "articles_select_own"
on public.articles
for select
to authenticated
using (auth.uid() = user_id and deleted_at is null);

drop policy if exists "articles_insert_own" on public.articles;
create policy "articles_insert_own"
on public.articles
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "articles_update_own" on public.articles;
create policy "articles_update_own"
on public.articles
for update
to authenticated
using (auth.uid() = user_id and deleted_at is null)
with check (auth.uid() = user_id);

drop policy if exists "bookmarks_select_own" on public.bookmarks;
create policy "bookmarks_select_own"
on public.bookmarks
for select
to authenticated
using (auth.uid() = user_id and deleted_at is null);

drop policy if exists "bookmarks_insert_own" on public.bookmarks;
create policy "bookmarks_insert_own"
on public.bookmarks
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "bookmarks_update_own" on public.bookmarks;
create policy "bookmarks_update_own"
on public.bookmarks
for update
to authenticated
using (auth.uid() = user_id and deleted_at is null)
with check (auth.uid() = user_id);

drop policy if exists "reading_marks_select_own" on public.reading_marks;
create policy "reading_marks_select_own"
on public.reading_marks
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "reading_marks_insert_own" on public.reading_marks;
create policy "reading_marks_insert_own"
on public.reading_marks
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "reading_marks_update_own" on public.reading_marks;
create policy "reading_marks_update_own"
on public.reading_marks
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update on public.articles to authenticated;
grant select, insert, update on public.bookmarks to authenticated;
grant select, insert, update on public.reading_marks to authenticated;
