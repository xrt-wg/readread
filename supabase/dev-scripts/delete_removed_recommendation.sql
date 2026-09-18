-- ============================================================================
-- delete_removed_recommendation.sql
-- 用途：物理删除一条已下架（status='removed'）的推荐，及其级联数据。
-- ⚠️ 不可逆。正式环境的推荐条目按设计应保留（前端无删除入口，仅下架），
--    本脚本只用于清理测试遗留。
--
-- 级联：recommendation_submission_snapshots / recommendation_ratings /
--       recommendation_submission_admin_reviews 均 ON DELETE CASCADE，会自动删除。
-- 注意：若有用户把该推荐加过书架，其 readings.share_source_id 会变成悬空 id（不报错，但来源链接失效）。
--       若该推荐正被 first_reading_config.submission_a/b 引用，删除会因外键报错失败。
-- ============================================================================

-- ① 先定位要删除的下架推荐 id（把邮箱换成提交者的邮箱）：
-- select id, title, status, source_url, created_at
-- from public.recommendation_submissions
-- where submitter_user_id = (select id from auth.users where email = 'your-account@example.com')
--   and status = 'removed';

-- ② 依赖检查（只读）：reading_copies 应为 0，referenced_by_config 应为 false/null
-- select
--   (select count(*) from public.readings where share_source_id = '<推荐id>') as reading_copies,
--   (select count(*) from public.recommendation_ratings where submission_id = '<推荐id>') as ratings,
--   (select bool_or(submission_a='<推荐id>' or submission_b='<推荐id>') from public.first_reading_config) as referenced_by_config;

-- ③ 删除（把 <推荐id> 换成 ① 查到的 id）
begin;
delete from public.recommendation_submissions
where id = '<推荐id>' and status = 'removed';
commit;
