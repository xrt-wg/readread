-- 软删除文章 RPC
-- 绕过 PostgREST PATCH + RLS 交互层面的 403 问题，使用 SECURITY DEFINER
-- 函数内部仍校验 auth.uid() = user_id，保持权限安全

create or replace function public.soft_delete_article(article_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  update public.articles
  set deleted_at = timezone('utc', now())
  where id = article_id
    and user_id = v_user_id
    and deleted_at is null;

  if not found then
    raise exception 'article not found or already deleted';
  end if;
end;
$$;

grant execute on function public.soft_delete_article(text) to authenticated;

-- 软删除文章关联书签 RPC（防御性措施）
-- bookmarks 表的 RLS UPDATE 策略与 articles 结构一致，存在同类 PostgREST PATCH+RLS 风险

create or replace function public.soft_delete_bookmarks_for_article(p_article_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  update public.bookmarks
  set deleted_at = timezone('utc', now())
  where article_id = p_article_id
    and user_id = v_user_id
    and deleted_at is null;
end;
$$;

grant execute on function public.soft_delete_bookmarks_for_article(text) to authenticated;
