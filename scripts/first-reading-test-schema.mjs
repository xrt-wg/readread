import { readFile } from 'node:fs/promises'
export async function fixtureSchema() {
const old = await readFile('supabase/migrations/20260711000000_unify_readings_table.sql', 'utf8')
return `
create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table profiles(user_id uuid primary key references auth.users(id) on delete cascade,status text default 'active');
${old.slice(old.indexOf('CREATE TABLE public.readings'), old.indexOf('-- ============================================================================', old.indexOf('CREATE TABLE public.readings')))}
create table bookmarks(id text primary key,user_id uuid references profiles(user_id) on delete cascade);
create table reading_marks(id text primary key,user_id uuid references profiles(user_id) on delete cascade);
create table recommendation_submissions(id text primary key,status text,intro text,add_count integer default 0,recommend_score numeric default 0,updated_at timestamptz);
create table recommendation_submission_snapshots(submission_id text primary key,title text,author text,source_url text,sections jsonb,format text,cover_url text,lang text,kind text);
create function compute_recommendation_score(text) returns numeric language sql as $$select 0::numeric$$;
${old.slice(old.indexOf('CREATE OR REPLACE FUNCTION public.increment_recommendation_add_count'), old.indexOf('-- 8.7 start_reading'))}
`

}
