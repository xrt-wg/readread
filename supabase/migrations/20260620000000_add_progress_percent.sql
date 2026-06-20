-- reading_marks 新增 progress_percent：标记时的阅读进度快照 (0–100)
-- 单章节 = 章节内滚动百分比；多章节 = 全书词数加权进度。
alter table public.reading_marks
add column if not exists progress_percent integer;

comment on column public.reading_marks.progress_percent is
  '标记时的阅读进度百分比 (0–100)，取自阅读器顶部栏 scroll% 快照。单章节 = 章节内滚动百分比；多章节 = 全书词数加权进度。';
