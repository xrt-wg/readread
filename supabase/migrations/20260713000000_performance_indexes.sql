-- ============================================================================
-- Migration A: 创建性能索引（全部 IF NOT EXISTS，不删除旧索引）
-- 日期: 2026-07-13
-- 说明: 覆盖高频查询模式，消除全表扫描和排序
-- 旧索引 idx_readings_user_status 和 idx_readings_share_source 的清理
-- 由后续清理 Migration 处理。
-- ============================================================================

-- 1. readings 阅读区查询（listReadingZone + start_reading RPC）
--    替换 idx_readings_user_status，新名称为 idx_readings_active_zone
CREATE INDEX IF NOT EXISTS idx_readings_active_zone
  ON public.readings (user_id, reading_status, deleted_at)
  INCLUDE (reading_started_at, created_at)
  WHERE reading_status = 'reading';

-- 2. readings updated_at 排序（fix_reading_limit migration 的 ROW_NUMBER 窗口）
CREATE INDEX IF NOT EXISTS idx_readings_user_updated
  ON public.readings (user_id, updated_at DESC);

-- 3. bookmarks 用户+文章+软删除（最频繁查询：listBookmarksByArticle）
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_reading_active
  ON public.bookmarks (user_id, reading_id, deleted_at);

-- 4. bookmarks 列表排序（listAllBookmarks）
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_created
  ON public.bookmarks (user_id, deleted_at, created_at DESC);

-- 5. bookmarks 服务端复习筛选（listDueBookmarks RPC / get_due_bookmarks）
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_next_review
  ON public.bookmarks (user_id, review_count, next_review_at, deleted_at);

-- 6. recommendation_submissions 标题去重（checkDuplicateSubmission）
CREATE INDEX IF NOT EXISTS idx_rec_submissions_title_active
  ON public.recommendation_submissions (title, status)
  WHERE status = 'active';

-- 7. readings share_source RPC 查询（increment_recommendation_add_count）
--    替换 idx_readings_share_source，新名称为 idx_readings_share_source_origin
CREATE INDEX IF NOT EXISTS idx_readings_share_source_origin
  ON public.readings (share_source_id, origin, deleted_at)
  WHERE share_source_id IS NOT NULL;

-- 8. reading_marks 完成状态查询（check_reading_completed RPC）
CREATE INDEX IF NOT EXISTS idx_reading_marks_user_completed
  ON public.reading_marks (user_id, completed)
  WHERE completed = true;

-- 9. audit_logs 默认列表排序
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON public.audit_logs (created_at DESC);

-- 10. profiles 管理页面排序（listAdminProfiles）
CREATE INDEX IF NOT EXISTS idx_profiles_last_seen
  ON public.profiles (last_seen_at DESC NULLS LAST);
