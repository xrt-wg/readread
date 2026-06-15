-- 书架与阅读区 — 删除素材 RPC
-- Phase 0 / 任务 0.5
-- 原子执行: 先 SET NULL articles.source_import_id，再软删除 import_items
-- 使用 SECURITY DEFINER 绕过 PostgREST PATCH+RLS 交互问题
-- 函数内部仍校验 auth.uid() = user_id，保持权限安全

CREATE OR REPLACE FUNCTION public.delete_import_item(p_import_item_id text)
RETURNS integer  -- 返回受影响的 articles 数量
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  affected_articles integer;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- 1. 解除已移入文章的溯源引用
  UPDATE public.articles
  SET source_import_id = NULL
  WHERE source_import_id = p_import_item_id
    AND user_id = v_user_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS affected_articles = ROW_COUNT;

  -- 2. 软删除素材
  UPDATE public.import_items
  SET deleted_at = timezone('utc', now())
  WHERE id = p_import_item_id
    AND user_id = v_user_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'import item not found or already deleted';
  END IF;

  RETURN affected_articles;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_import_item(text) TO authenticated;
