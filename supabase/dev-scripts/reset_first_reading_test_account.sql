-- ============================================================================
-- reset_first_reading_test_account.sql
-- 用途：把一个测试账号初始化成「从未使用」的状态，用于反复验证「首次阅读选文弹窗」。
-- ⚠️ 仅限本地/测试环境。正式环境禁止用清空用户数据或批量重置 handled 状态来回退（违反 D09 上线回退规范）。
--
-- 用法：把下面 email 换成测试账号邮箱，整段执行即可。可反复运行（幂等）。
--
-- 关键顺序：必须先删使用证据，最后再把状态重置为 pending ——
-- readings / bookmarks / reading_marks 上的 guard_reading_user_write 触发器会在任何
-- 删除时把状态改回 suppressed，若顺序颠倒，重置会被触发器覆盖。
-- ============================================================================

do $$
declare u uuid;
begin
  select id into u from auth.users where email = 'your-test-account@example.com';  -- ← 替换成测试账号邮箱
  if u is null then
    raise exception '未找到该邮箱对应的账号';
  end if;

  -- 1) 清使用证据（先删）
  delete from public.reading_marks where user_id = u;   -- 阅读进度
  delete from public.bookmarks    where user_id = u;    -- 划词收藏
  delete from public.readings     where user_id = u;    -- 阅读/书架（含软删）

  -- 2) 最后把状态重置为 pending
  insert into public.user_first_reading_states(user_id, status)
  values (u, 'pending')
  on conflict (user_id) do update
    set status = 'pending',
        selected_submission_id = null,
        selected_reading_id = null,
        handled_at = null,
        updated_at = now();
end $$;

-- 验证：status 应为 pending
-- select user_id, status, selected_submission_id, selected_reading_id, handled_at
-- from public.user_first_reading_states
-- where user_id = (select id from auth.users where email = 'your-test-account@example.com');
