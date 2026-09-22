-- ============================================================================
-- Migration: 重新阅读 RPC — 清场（软删书签 + 删阅读标记）后直接置 reading
-- 日期: 2026-09-22
-- 说明: 统一「取书到阅读区」模型后，重新阅读 = 清场 + 直接开读，一步进阅读区。
--       此前 JS 侧分三步执行，其中 reading_marks 无 DELETE RLS 策略、
--       grant 仅 select/insert/update，直接 .delete() 会被拒导致标记清不掉。
--       改为单 RPC 在 SECURITY DEFINER 下原子完成，并对齐新版 RPC 约定：
--       errcode='42501' + 显式 advisory lock + revoke-all 后 grant execute。
-- ============================================================================

begin;

CREATE OR REPLACE FUNCTION public.restart_reading(p_reading_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  PERFORM public.lock_reading_user(auth.uid());

  -- 1. 软删除关联 bookmarks
  UPDATE public.bookmarks
  SET deleted_at = now()
  WHERE reading_id = p_reading_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;

  -- 2. 清除 reading_mark（真删除，不留 tombstone）
  DELETE FROM public.reading_marks
  WHERE reading_id = p_reading_id
    AND user_id = auth.uid();

  -- 3. 清场后直接置 reading（重新开读）
  UPDATE public.readings
  SET reading_status = 'reading',
      reading_started_at = now(),
      reading_finished_at = NULL,
      updated_at = now()
  WHERE id = p_reading_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.restart_reading(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restart_reading(text) TO authenticated;

notify pgrst, 'reload schema';
commit;
