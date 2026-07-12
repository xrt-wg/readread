-- 存量未读和进行中的阅读内容批量转入阅读区
-- 符合状态机：unread → reading、in_progress → reading 均为合法转换
update public.readings
set
  reading_status = 'reading',
  reading_started_at = coalesce(reading_started_at, timezone('utc', now())),
  updated_at = timezone('utc', now())
where reading_status in ('unread', 'in_progress')
  and deleted_at is null;
