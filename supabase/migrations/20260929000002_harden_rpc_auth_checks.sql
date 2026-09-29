-- ============================================================================
-- Migration: 4 个越权修复 RPC 的硬化（对齐代码库惯例）
-- 日期: 2026-09-29
-- 说明: get_due_bookmarks / upsert_reading_mark_position / clear_reading_mark_position /
--       set_reading_mark_completed 均为 SECURITY DEFINER，且历史版本既未带
--       `SET search_path = public`，也未显式 REVOKE public/anon 执行权。
--       restart_reading / admin_get_growth_stats / admin_grant_pro 等新函数均带
--       `set search_path = public` + `revoke all ... grant execute to authenticated`。
--       此处用 ALTER FUNCTION ... SET 补齐 search_path（防御 search_path 劫持），
--       再 REVOKE ALL + GRANT EXECUTE TO authenticated 收口执行权。
--       函数体已含 auth.uid() 越权闸门（20260929000000），此处不改函数体。
-- 执行方式: Dashboard SQL Editor 手动执行（无本地 CLI）。
-- ============================================================================

-- ─── 1. 补齐 SET search_path = public ────────────────────────────────────────
ALTER FUNCTION public.get_due_bookmarks(uuid, integer) SET search_path = public;
ALTER FUNCTION public.upsert_reading_mark_position(uuid, text, integer, integer, text) SET search_path = public;
ALTER FUNCTION public.clear_reading_mark_position(uuid, text) SET search_path = public;
ALTER FUNCTION public.set_reading_mark_completed(uuid, text) SET search_path = public;

-- ─── 2. 显式授权：仅 authenticated 可执行 ──────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_due_bookmarks(uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_due_bookmarks(uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_reading_mark_position(uuid, text, integer, integer, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_reading_mark_position(uuid, text, integer, integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.clear_reading_mark_position(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_reading_mark_position(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_reading_mark_completed(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_reading_mark_completed(uuid, text) TO authenticated;

-- ─── 3. 刷新 PostgREST 函数缓存 ───────────────────────────────────────────────
notify pgrst, 'reload schema';
