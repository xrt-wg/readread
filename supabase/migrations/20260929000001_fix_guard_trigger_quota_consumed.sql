-- ============================================================================
-- Migration: 修复 guard_reading_user_write 触发器在 reading_marks 上 42703
-- 日期: 2026-09-29
-- 说明: 订阅机制（20260923000000_subscription_mechanism.sql）扩展
--       guard_reading_user_write 时，额度消耗判定写成扁平 IF：
--
--         if tg_table_name = 'readings' and tg_op = 'INSERT'
--            and coalesce(new.quota_consumed, false) and ... then
--
--       把 new.quota_consumed 与 tg_table_name 判断放进同一表达式。quota_consumed
--       仅存在于 readings / bookmarks，reading_marks 没有该列；而该触发器同时挂在
--       readings、bookmarks、reading_marks 三表上（20260917000003）。
--
--       PL/pgSQL 按语句惰性规划：嵌套 IF 的内层语句仅在表名判断成立后才被规划
--       （原函数 new.reading_status 段即用嵌套写法，故在 reading_marks 上不炸）；
--       扁平 IF 是单表达式，触发器落到 reading_marks 时仍解析 new.quota_consumed，
--       报 42703 "record \"new\" has no field \"quota_consumed\""（HTTP 400），
--       导致所有 reading_marks 写入（upsert/clear/set reading mark）失败。
--
--       修复：额度判定改为嵌套 IF，先确认表名、再在分支内引用 new.quota_consumed，
--       与既有 reading_status 判定同构，触发器落到无该列的表时不再解析该引用。
--       函数其余逻辑保持不变。
-- 执行方式: Dashboard SQL Editor 手动执行（无本地 CLI）。
-- ============================================================================

create or replace function public.guard_reading_user_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if tg_op = 'DELETE' then v_user := old.user_id; else v_user := new.user_id; end if;
  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    raise exception 'Cannot transfer reading data between accounts';
  end if;
  perform public.lock_reading_user(v_user);
  -- Account deletion cascades must not recreate a state row referencing the deleted account.
  if tg_op = 'DELETE' and not exists(select 1 from auth.users where id=v_user) then return old; end if;
  if tg_table_name = 'readings' and tg_op <> 'DELETE' then
    if new.reading_status = 'reading' and new.deleted_at is null then
      if (select count(*) from public.readings where user_id = v_user and reading_status = 'reading'
          and deleted_at is null and id <> new.id) >= 5 then
        raise exception '阅读区已满（上限 5 本），可选择先取回再加入';
      end if;
    end if;
  end if;
  -- 额度消耗（真新增判定 + 判别键）
  -- 嵌套 IF：先判表名，再在其分支内引用 new.quota_consumed，避免在无该列的表上解析字段。
  if tg_table_name = 'readings' and tg_op = 'INSERT' then
    if coalesce(new.quota_consumed, false)
       and not exists (select 1 from public.readings where id = new.id) then
      perform public.consume_import_quota(v_user);
    end if;
  end if;
  if tg_table_name = 'bookmarks' and tg_op = 'INSERT' then
    if coalesce(new.quota_consumed, false)
       and not exists (select 1 from public.bookmarks where id = new.id) then
      perform public.consume_bookmark_quota(v_user);
    end if;
  end if;
  insert into public.user_first_reading_states(user_id, status, handled_at)
    values (v_user, 'suppressed', now())
    on conflict (user_id) do update set status = 'suppressed', handled_at = now(), updated_at = now()
      where user_first_reading_states.status = 'pending';
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
