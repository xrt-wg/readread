-- ============================================================================
-- 订阅机制 · 运行时验收 SQL 冒烟脚本（结果进 Results 表格版）
-- 用途：在 Supabase Dashboard SQL Editor 中，逐段验证后端核心逻辑。
-- 用法：一次只复制「一个 STEP」整块执行，结果会以表格形式出现在 Results 里，
--       每一行是一个检查项，result 列为 PASS / FAIL，detail 列给出实际值。
-- 安全：脚本会先快照测试账号的订阅/额度状态，跑完再原样恢复，不污染真实数据。
-- 前置：库里已应用 20260923000000_subscription_mechanism.sql（含 E2 修复）。
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- STEP 0 · 前置检查（可选，确认环境就绪）
-- 期望：四个函数都非空（存在）
-- ════════════════════════════════════════════════════════════════════════════
select
  to_regprocedure('public.consume_import_quota(uuid)')        as consume_import_ok,
  to_regprocedure('public.consume_bookmark_quota(uuid)')      as consume_bookmark_ok,
  to_regprocedure('public.get_subscription_status()')         as get_status_ok,
  to_regprocedure('public.admin_grant_pro(uuid,integer,text)') as admin_grant_ok;


-- ════════════════════════════════════════════════════════════════════════════
-- STEP 1 · 额度杠杆核心：consume_import_quota / consume_bookmark_quota
-- 验证点：1a 导入正常 +1；1b Q0001 额度墙；1c 收藏正常 +1；
--         1d 周滚动重置为 1；1e Q0002 额度墙；1f Pro 不占额度
-- ════════════════════════════════════════════════════════════════════════════
create temp table if not exists _smoke(seq int, label text, ok boolean, detail text);
delete from _smoke;

do $$
declare
  v_user uuid := (
    select u.id from auth.users u
    where exists (select 1 from public.profiles p where p.user_id = u.id)
    order by u.created_at desc limit 1
  );
  v_sub   public.subscriptions;   -- 基线快照
  v_quota public.user_quotas;     -- 基线快照
  v_limit int;
  v_count int;
  v_bm int;
begin
  if v_user is null then
    insert into _smoke values (0, '前置检查', false, '未找到「有 profile 的账号」，请先在应用里注册/登录');
    return;
  end if;
  insert into _smoke values (0, '测试账号', true, v_user::text);

  -- 快照基线（跑完要恢复）
  select * into v_sub   from public.subscriptions where user_id = v_user;
  select * into v_quota from public.user_quotas    where user_id = v_user;

  -- 重置为 Free 且额度清零，保证结果确定
  insert into public.subscriptions(user_id) values (v_user)
    on conflict (user_id) do update set pro_expires_at = null;
  insert into public.user_quotas(user_id, import_lifetime_count, bookmark_week_count, bookmark_week_start)
    values (v_user, 0, 0, null)
    on conflict (user_id) do update set import_lifetime_count = 0, bookmark_week_count = 0, bookmark_week_start = null;

  -- 1a. 导入正常消费：0 → 1
  perform public.consume_import_quota(v_user);
  select import_lifetime_count into v_count from public.user_quotas where user_id = v_user;
  insert into _smoke values (1, '1a 导入正常消费 0→1', v_count = 1, '实际=' || v_count);

  -- 1b. Q0001 额度墙
  select coalesce(import_free_limit, 30) into v_limit from public.subscription_config where id = true;
  update public.user_quotas set import_lifetime_count = v_limit where user_id = v_user;
  begin
    perform public.consume_import_quota(v_user);
    insert into _smoke values (2, '1b Q0001 额度墙', false, '未触发异常');
  exception when others then
    insert into _smoke values (2, '1b Q0001 额度墙', sqlerrm like '%导入额度已用完%', sqlerrm);
  end;

  -- 1c. 收藏正常消费：0 → 1
  perform public.consume_bookmark_quota(v_user);
  select bookmark_week_count into v_count from public.user_quotas where user_id = v_user;
  insert into _smoke values (3, '1c 收藏正常消费 0→1', v_count = 1, '实际=' || v_count);

  -- 1d. 周滚动：拨到上周、count=7，再消费应重置为 1
  update public.user_quotas
     set bookmark_week_start = date_trunc('week', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai' - interval '7 days',
         bookmark_week_count = 7
   where user_id = v_user;
  perform public.consume_bookmark_quota(v_user);
  select bookmark_week_count into v_count from public.user_quotas where user_id = v_user;
  insert into _smoke values (4, '1d 周滚动重置为 1', v_count = 1, '实际=' || v_count);

  -- 1e. Q0002 额度墙
  select coalesce(bookmark_week_limit, 30) into v_limit from public.subscription_config where id = true;
  update public.user_quotas set bookmark_week_count = v_limit where user_id = v_user;
  begin
    perform public.consume_bookmark_quota(v_user);
    insert into _smoke values (5, '1e Q0002 额度墙', false, '未触发异常');
  exception when others then
    insert into _smoke values (5, '1e Q0002 额度墙', sqlerrm like '%收藏额度已用完%', sqlerrm);
  end;

  -- 1f. Pro 不占额度
  update public.subscriptions set pro_expires_at = now() + interval '30 days' where user_id = v_user;
  update public.user_quotas set import_lifetime_count = 0, bookmark_week_count = 0 where user_id = v_user;
  perform public.consume_import_quota(v_user);
  perform public.consume_bookmark_quota(v_user);
  select import_lifetime_count, bookmark_week_count into v_count, v_bm from public.user_quotas where user_id = v_user;
  insert into _smoke values (6, '1f Pro 不占额度', v_count = 0 and v_bm = 0, '导入=' || v_count || '，收藏=' || v_bm);

  -- 恢复基线
  delete from public.user_quotas where user_id = v_user;
  if v_quota.user_id is not null then
    insert into public.user_quotas(user_id, import_lifetime_count, bookmark_week_start, bookmark_week_count, updated_at)
    values (v_quota.user_id, v_quota.import_lifetime_count, v_quota.bookmark_week_start, v_quota.bookmark_week_count, v_quota.updated_at);
  end if;
  delete from public.subscriptions where user_id = v_user;
  if v_sub.user_id is not null then
    insert into public.subscriptions(user_id, pro_expires_at, pro_source, created_at, updated_at)
    values (v_sub.user_id, v_sub.pro_expires_at, v_sub.pro_source, v_sub.created_at, v_sub.updated_at);
  end if;
end $$;

select seq, label, case when ok then 'PASS' else 'FAIL' end as result, detail from _smoke order by seq;


-- ════════════════════════════════════════════════════════════════════════════
-- STEP 2 · P1 触发器无双计（最高风险项）
-- 验证点：2a 插入阅读消费导入 1 次；2b 插入收藏消费收藏 1 次；
--         2c 翻译回写（quota_consumed=false）不重复计数；
--         2d 同 id 重试（quota_consumed=true）被 not exists 挡下
-- ════════════════════════════════════════════════════════════════════════════
create temp table if not exists _smoke(seq int, label text, ok boolean, detail text);
delete from _smoke;

do $$
declare
  v_user uuid := (
    select u.id from auth.users u
    where exists (select 1 from public.profiles p where p.user_id = u.id)
    order by u.created_at desc limit 1
  );
  v_sub   public.subscriptions;
  v_quota public.user_quotas;
  v_state public.user_first_reading_states;
  v_import int;
  v_bm int;
begin
  if v_user is null then
    insert into _smoke values (0, '前置检查', false, '未找到「有 profile 的账号」，请先在应用里注册/登录');
    return;
  end if;
  insert into _smoke values (0, '测试账号', true, v_user::text);

  -- 快照基线
  select * into v_sub   from public.subscriptions where user_id = v_user;
  select * into v_quota from public.user_quotas    where user_id = v_user;
  select * into v_state from public.user_first_reading_states where user_id = v_user;

  -- 重置为 Free + 额度清零
  insert into public.subscriptions(user_id) values (v_user)
    on conflict (user_id) do update set pro_expires_at = null;
  insert into public.user_quotas(user_id, import_lifetime_count, bookmark_week_count, bookmark_week_start)
    values (v_user, 0, 0, null)
    on conflict (user_id) do update set import_lifetime_count = 0, bookmark_week_count = 0, bookmark_week_start = null;

  -- 清理可能残留的冒烟测试行
  delete from public.bookmarks where id = '__smoke_bookmark__';
  delete from public.readings   where id = '__smoke_reading__';

  -- 2a. 插入阅读（quota_consumed=true）→ 导入计数 +1
  insert into public.readings (id, user_id, title, quota_consumed)
    values ('__smoke_reading__', v_user, '冒烟测试文章', true);
  select import_lifetime_count into v_import from public.user_quotas where user_id = v_user;
  insert into _smoke values (1, '2a 插入阅读消费导入额度 1 次', v_import = 1, '导入=' || v_import);

  -- 2b. 插入收藏（quota_consumed=true）→ 收藏计数 +1
  insert into public.bookmarks (id, user_id, reading_id, type, text, quota_consumed)
    values ('__smoke_bookmark__', v_user, '__smoke_reading__', 'word', 'smoke', true);
  select bookmark_week_count into v_bm from public.user_quotas where user_id = v_user;
  insert into _smoke values (2, '2b 插入收藏消费收藏额度 1 次', v_bm = 1, '收藏=' || v_bm);

  -- 2c. 翻译回写（quota_consumed=false 的 upsert）→ 不重复计数
  insert into public.bookmarks (id, user_id, reading_id, type, text, translation_status, quota_consumed)
    values ('__smoke_bookmark__', v_user, '__smoke_reading__', 'word', 'smoke', 'done', false)
    on conflict (id) do update set translation_status = excluded.translation_status, quota_consumed = false;
  select bookmark_week_count into v_bm from public.user_quotas where user_id = v_user;
  insert into _smoke values (3, '2c 回写不重复计数（仍=1）', v_bm = 1, '收藏=' || v_bm);

  -- 2d. 同 id 重试（quota_consumed=true）→ not exists 挡下
  insert into public.bookmarks (id, user_id, reading_id, type, text, quota_consumed)
    values ('__smoke_bookmark__', v_user, '__smoke_reading__', 'word', 'smoke', true)
    on conflict (id) do update set quota_consumed = true;
  select bookmark_week_count into v_bm from public.user_quotas where user_id = v_user;
  insert into _smoke values (4, '2d not exists 挡下同 id 重试（仍=1）', v_bm = 1, '收藏=' || v_bm);

  -- 清理冒烟测试行
  delete from public.bookmarks where id = '__smoke_bookmark__';
  delete from public.readings   where id = '__smoke_reading__';

  -- 恢复基线
  delete from public.user_quotas where user_id = v_user;
  if v_quota.user_id is not null then
    insert into public.user_quotas(user_id, import_lifetime_count, bookmark_week_start, bookmark_week_count, updated_at)
    values (v_quota.user_id, v_quota.import_lifetime_count, v_quota.bookmark_week_start, v_quota.bookmark_week_count, v_quota.updated_at);
  end if;
  delete from public.subscriptions where user_id = v_user;
  if v_sub.user_id is not null then
    insert into public.subscriptions(user_id, pro_expires_at, pro_source, created_at, updated_at)
    values (v_sub.user_id, v_sub.pro_expires_at, v_sub.pro_source, v_sub.created_at, v_sub.updated_at);
  end if;
  delete from public.user_first_reading_states where user_id = v_user;
  if v_state.user_id is not null then
    insert into public.user_first_reading_states(user_id, status, selected_submission_id, selected_reading_id, handled_at, created_at, updated_at)
    values (v_state.user_id, v_state.status, v_state.selected_submission_id, v_state.selected_reading_id, v_state.handled_at, v_state.created_at, v_state.updated_at);
  end if;
end $$;

select seq, label, case when ok then 'PASS' else 'FAIL' end as result, detail from _smoke order by seq;


-- ════════════════════════════════════════════════════════════════════════════
-- STEP 3 · get_subscription_status 额度 0 兜底（E2）
-- 验证点：无 user_quotas 行的新用户，importUsed/bookmarkUsed 应为 0 而非 null
-- 说明：通过 set_config 模拟「已登录会话」，让 auth.uid() 返回测试账号。
--       若模拟失败（detail 里 importLimit=null），本步会 FAIL，如实反馈即可。
-- ════════════════════════════════════════════════════════════════════════════
create temp table if not exists _smoke(seq int, label text, ok boolean, detail text);
delete from _smoke;

do $$
declare
  v_user uuid := (
    select u.id from auth.users u
    where exists (select 1 from public.profiles p where p.user_id = u.id)
    order by u.created_at desc limit 1
  );
  v_quota public.user_quotas;
  v_result jsonb;
begin
  if v_user is null then
    insert into _smoke values (0, '前置检查', false, '未找到「有 profile 的账号」，请先在应用里注册/登录');
    return;
  end if;
  insert into _smoke values (0, '测试账号', true, v_user::text);

  -- 快照 user_quotas（本步会删它）
  select * into v_quota from public.user_quotas where user_id = v_user;

  -- 模拟已登录会话
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  -- 删除 user_quotas 行，模拟「从未消费过额度」的新用户
  delete from public.user_quotas where user_id = v_user;
  insert into public.subscriptions(user_id) values (v_user) on conflict (user_id) do nothing;

  select public.get_subscription_status() into v_result;

  insert into _smoke values (1, '3 新用户额度为 0（非 null）且 plan=free',
    (v_result->>'importUsed') = '0'
      and (v_result->>'bookmarkUsed') = '0'
      and (v_result->>'plan') = 'free'
      and (v_result->>'importLimit') is not null,
    v_result::text);

  -- 恢复 user_quotas
  delete from public.user_quotas where user_id = v_user;
  if v_quota.user_id is not null then
    insert into public.user_quotas(user_id, import_lifetime_count, bookmark_week_start, bookmark_week_count, updated_at)
    values (v_quota.user_id, v_quota.import_lifetime_count, v_quota.bookmark_week_start, v_quota.bookmark_week_count, v_quota.updated_at);
  end if;
end $$;

select seq, label, case when ok then 'PASS' else 'FAIL' end as result, detail from _smoke order by seq;


-- ════════════════════════════════════════════════════════════════════════════
-- STEP 4 · 管理员发 Pro：admin_grant_pro（支付接入前 Pro 唯一发放路径）
-- 验证点：4a 非管理员拒绝；4b 非正天数拒绝；4c 用户不存在拒绝；
--         4d 正向发 30 天（到期 + 账本 + 审计）；4e 再次发放叠加（greatest 不覆盖）
-- 说明：audit_logs 为 append-only，本步会留下若干条 smoke 审计行（无害，恰是证据）。
-- ════════════════════════════════════════════════════════════════════════════
create temp table if not exists _smoke(seq int, label text, ok boolean, detail text);
delete from _smoke;

do $$
declare
  v_user uuid := (
    select u.id from auth.users u
    where exists (select 1 from public.profiles p where p.user_id = u.id)
    order by u.created_at desc limit 1
  );
  v_sub        public.subscriptions;
  v_admin_role public.admin_roles;
  v_pg_max     bigint;
  v_pro        timestamptz;
  v_grants     int;
  v_audit      int;
begin
  if v_user is null then
    insert into _smoke values (0, '前置检查', false, '未找到「有 profile 的账号」，请先在应用里注册/登录');
    return;
  end if;
  insert into _smoke values (0, '测试账号', true, v_user::text);

  -- 快照基线
  select * into v_sub        from public.subscriptions where user_id = v_user;
  select * into v_admin_role from public.admin_roles   where user_id = v_user;
  select coalesce(max(id), 0) into v_pg_max from public.pro_grants where user_id = v_user;

  -- 测试起点：v_user 不是 admin、且为 Free
  delete from public.admin_roles where user_id = v_user;
  insert into public.subscriptions(user_id) values (v_user)
    on conflict (user_id) do update set pro_expires_at = null, pro_source = null;

  -- 模拟登录会话（auth.uid() = v_user）
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  -- 4a. 非管理员拒绝
  begin
    perform public.admin_grant_pro(v_user, 30, 'smoke');
    insert into _smoke values (1, '4a 非管理员拒绝', false, '未触发异常');
  exception when others then
    insert into _smoke values (1, '4a 非管理员拒绝', sqlerrm like '%无管理员权限%', sqlerrm);
  end;

  -- 临时授予 admin
  insert into public.admin_roles(user_id) values (v_user);

  -- 4b. 非正天数拒绝
  begin
    perform public.admin_grant_pro(v_user, 0, 'smoke');
    insert into _smoke values (2, '4b 非正天数拒绝', false, '未触发异常');
  exception when others then
    insert into _smoke values (2, '4b 非正天数拒绝', sqlerrm like '%天数必须为正整数%', sqlerrm);
  end;

  -- 4c. 用户不存在拒绝
  begin
    perform public.admin_grant_pro('ffffffff-ffff-ffff-ffff-ffffffffffff', 30, 'smoke');
    insert into _smoke values (3, '4c 用户不存在拒绝', false, '未触发异常');
  exception when others then
    insert into _smoke values (3, '4c 用户不存在拒绝', sqlerrm like '%用户不存在%', sqlerrm);
  end;

  -- 4d. 正向发 30 天
  perform public.admin_grant_pro(v_user, 30, 'smoke');
  select pro_expires_at into v_pro from public.subscriptions where user_id = v_user;
  select count(*) into v_grants from public.pro_grants where user_id = v_user and source = 'admin' and days = 30;
  select count(*) into v_audit from public.audit_logs where actor_user_id = v_user and action = 'subscription.admin_grant';
  insert into _smoke values (4, '4d 正向发 30 天',
    v_pro between now() + interval '29 days' and now() + interval '31 days'
      and v_grants >= 1 and v_audit >= 1,
    '到期=' || v_pro || '；账本=' || v_grants || '；审计=' || v_audit);

  -- 4e. 再次发放叠加（greatest 不覆盖、累加到到期日之后）
  perform public.admin_grant_pro(v_user, 30, 'smoke');
  select pro_expires_at into v_pro from public.subscriptions where user_id = v_user;
  insert into _smoke values (5, '4e 再次发放叠加至 ~60 天',
    v_pro between now() + interval '59 days' and now() + interval '61 days',
    '到期=' || v_pro);

  -- 恢复基线
  delete from public.pro_grants where user_id = v_user and id > v_pg_max;
  delete from public.subscriptions where user_id = v_user;
  if v_sub.user_id is not null then
    insert into public.subscriptions(user_id, pro_expires_at, pro_source, created_at, updated_at)
    values (v_sub.user_id, v_sub.pro_expires_at, v_sub.pro_source, v_sub.created_at, v_sub.updated_at);
  end if;
  delete from public.admin_roles where user_id = v_user;
  if v_admin_role.user_id is not null then
    insert into public.admin_roles(user_id, role, granted_by, granted_at, revoked_at, created_at, updated_at)
    values (v_admin_role.user_id, v_admin_role.role, v_admin_role.granted_by, v_admin_role.granted_at, v_admin_role.revoked_at, v_admin_role.created_at, v_admin_role.updated_at);
  end if;
end $$;

select seq, label, case when ok then 'PASS' else 'FAIL' end as result, detail from _smoke order by seq;


-- ════════════════════════════════════════════════════════════════════════════
-- STEP 5 · 社区贡献上架奖励：admin_publish_recommendation 首次上架发 Pro
-- 验证点：5a 首次上架 → 状态 active + 首次发布时间落定 + 发 30 天 contribution；
--         5b 幂等（同篇 grant_contribution_pro 只奖一次）；
--         5c 月上限撞顶 → 作废不发放 + 记审计
-- 说明：audit_logs 为 append-only，本步会留下若干条 smoke 审计行（无害，恰是证据）。
-- ════════════════════════════════════════════════════════════════════════════
create temp table if not exists _smoke(seq int, label text, ok boolean, detail text);
delete from _smoke;

do $$
declare
  v_user uuid := (
    select u.id from auth.users u
    where exists (select 1 from public.profiles p where p.user_id = u.id)
    order by u.created_at desc limit 1
  );
  v_sub        public.subscriptions;
  v_admin_role public.admin_roles;
  v_pg_max     bigint;
  v_pro        timestamptz;
  v_first      timestamptz;
  v_status     text;
  v_grants     int;
  v_days       int;
  v_cap        int;
  v_audit      int;
begin
  if v_user is null then
    insert into _smoke values (0, '前置检查', false, '未找到「有 profile 的账号」，请先在应用里注册/登录');
    return;
  end if;
  insert into _smoke values (0, '测试账号', true, v_user::text);

  -- 快照基线
  select * into v_sub        from public.subscriptions where user_id = v_user;
  select * into v_admin_role from public.admin_roles   where user_id = v_user;
  select coalesce(max(id), 0) into v_pg_max from public.pro_grants where user_id = v_user;
  select coalesce(contribution_days_per_publish, 30), coalesce(contribution_monthly_cap_days, 60)
    into v_days, v_cap from public.subscription_config where id = true;

  -- 测试起点：v_user 为 Free 且是 admin；清理可能残留的冒烟行
  delete from public.recommendation_submissions where id = '__smoke_sub__';
  delete from public.admin_roles where user_id = v_user;
  insert into public.admin_roles(user_id) values (v_user);
  insert into public.subscriptions(user_id) values (v_user)
    on conflict (user_id) do update set pro_expires_at = null, pro_source = null;

  -- 构造一条「已通过」的推荐（intro 非空 + 1 条摘录，满足发布前置）
  insert into public.recommendation_submissions (id, submitter_user_id, reading_id, title, intro, excerpts, status)
    values ('__smoke_sub__', v_user, '__smoke_reading__', '冒烟推荐', '这是一条冒烟推荐语', array['冒烟摘录'], 'approved');

  -- 模拟登录会话（auth.uid() = v_user，即管理员）
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  -- 5a. 首次上架发 Pro
  perform public.admin_publish_recommendation('__smoke_sub__', 'smoke');
  select status, first_published_at into v_status, v_first from public.recommendation_submissions where id = '__smoke_sub__';
  select pro_expires_at into v_pro from public.subscriptions where user_id = v_user;
  select count(*) into v_grants from public.pro_grants where user_id = v_user and source = 'contribution' and submission_id = '__smoke_sub__';
  insert into _smoke values (1, '5a 首次上架发 Pro',
    v_status = 'active' and v_first is not null
      and v_pro between now() + (v_days - 1) * interval '1 day' and now() + (v_days + 1) * interval '1 day'
      and v_grants = 1,
    '状态=' || v_status || '；首次=' || v_first || '；到期=' || v_pro || '；账本=' || v_grants);

  -- 5b. 幂等：同篇再奖一次应被挡下（账本仍 1 行、到期不再延长）
  perform public.grant_contribution_pro(v_user, '__smoke_sub__');
  select count(*) into v_grants from public.pro_grants where user_id = v_user and source = 'contribution' and submission_id = '__smoke_sub__';
  insert into _smoke values (2, '5b 同篇幂等（账本仍 1 行）', v_grants = 1, '账本=' || v_grants);

  -- 5c. 月上限：把当月 contribution 天数拨满，换新篇 → 作废不发放 + 审计
  insert into public.pro_grants(user_id, source, days, submission_id)
    values (v_user, 'contribution', v_cap, '__smoke_cap__');
  perform public.grant_contribution_pro(v_user, '__smoke_sub2__');
  select count(*) into v_grants from public.pro_grants where user_id = v_user and source = 'contribution' and submission_id = '__smoke_sub2__';
  select count(*) into v_audit from public.audit_logs where action = 'subscription.contribution_capped' and target_id = '__smoke_sub2__';
  insert into _smoke values (3, '5c 月上限撞顶（不发放 + 审计）', v_grants = 0 and v_audit >= 1, '新账本=' || v_grants || '；上限审计=' || v_audit);

  -- 恢复基线
  delete from public.recommendation_submissions where id = '__smoke_sub__';
  delete from public.pro_grants where user_id = v_user and id > v_pg_max;
  delete from public.subscriptions where user_id = v_user;
  if v_sub.user_id is not null then
    insert into public.subscriptions(user_id, pro_expires_at, pro_source, created_at, updated_at)
    values (v_sub.user_id, v_sub.pro_expires_at, v_sub.pro_source, v_sub.created_at, v_sub.updated_at);
  end if;
  delete from public.admin_roles where user_id = v_user;
  if v_admin_role.user_id is not null then
    insert into public.admin_roles(user_id, role, granted_by, granted_at, revoked_at, created_at, updated_at)
    values (v_admin_role.user_id, v_admin_role.role, v_admin_role.granted_by, v_admin_role.granted_at, v_admin_role.revoked_at, v_admin_role.created_at, v_admin_role.updated_at);
  end if;
end $$;

select seq, label, case when ok then 'PASS' else 'FAIL' end as result, detail from _smoke order by seq;


-- ════════════════════════════════════════════════════════════════════════════
-- STEP 6 · 额度豁免与单调性：offer/备份恢复不计（A1）+ 删书不释放（A2）
-- 验证点：6a 阅读 quota_consumed=false → 导入不计；
--         6b 收藏 quota_consumed=false → 收藏不计；
--         6c 阅读 quota_consumed=true → 导入 +1（对照：豁免来自 flag 非触发器失效）；
--         6d 软删该阅读 → 导入计数不回退（A2 终身单调）
-- 说明：首次阅读 offer（choose_first_reading_offer）与备份恢复（importLibraryData）
--       都不写 quota_consumed 列，走「缺省 false」路径，与本步 6a/6b 同一条分支。
-- ════════════════════════════════════════════════════════════════════════════
create temp table if not exists _smoke(seq int, label text, ok boolean, detail text);
delete from _smoke;

do $$
declare
  v_user uuid := (
    select u.id from auth.users u
    where exists (select 1 from public.profiles p where p.user_id = u.id)
    order by u.created_at desc limit 1
  );
  v_sub   public.subscriptions;
  v_quota public.user_quotas;
  v_state public.user_first_reading_states;
  v_import int;
  v_bm int;
begin
  if v_user is null then
    insert into _smoke values (0, '前置检查', false, '未找到「有 profile 的账号」，请先在应用里注册/登录');
    return;
  end if;
  insert into _smoke values (0, '测试账号', true, v_user::text);

  -- 快照基线
  select * into v_sub   from public.subscriptions where user_id = v_user;
  select * into v_quota from public.user_quotas    where user_id = v_user;
  select * into v_state from public.user_first_reading_states where user_id = v_user;

  -- 重置为 Free + 额度清零
  insert into public.subscriptions(user_id) values (v_user)
    on conflict (user_id) do update set pro_expires_at = null;
  insert into public.user_quotas(user_id, import_lifetime_count, bookmark_week_count, bookmark_week_start)
    values (v_user, 0, 0, null)
    on conflict (user_id) do update set import_lifetime_count = 0, bookmark_week_count = 0, bookmark_week_start = null;

  -- 清理可能残留的冒烟测试行
  delete from public.bookmarks where id in ('__smoke_bookmark__', '__smoke_bookmark2__');
  delete from public.readings   where id in ('__smoke_reading__', '__smoke_reading2__');

  -- 6a. 阅读 quota_consumed=false（缺省，offer/恢复路径）→ 导入不计
  insert into public.readings (id, user_id, title)
    values ('__smoke_reading__', v_user, '冒烟测试文章');
  select import_lifetime_count into v_import from public.user_quotas where user_id = v_user;
  insert into _smoke values (1, '6a 阅读 quota_consumed=false 不计', v_import = 0, '导入=' || v_import);

  -- 6b. 收藏 quota_consumed=false（备份恢复路径）→ 收藏不计
  insert into public.bookmarks (id, user_id, reading_id, type, text)
    values ('__smoke_bookmark__', v_user, '__smoke_reading__', 'word', 'smoke');
  select bookmark_week_count into v_bm from public.user_quotas where user_id = v_user;
  insert into _smoke values (2, '6b 收藏 quota_consumed=false 不计', v_bm = 0, '收藏=' || v_bm);

  -- 6c. 阅读 quota_consumed=true → 导入 +1（对照：豁免确实来自 flag，而非触发器整体失效）
  insert into public.readings (id, user_id, title, quota_consumed)
    values ('__smoke_reading2__', v_user, '冒烟测试文章2', true);
  select import_lifetime_count into v_import from public.user_quotas where user_id = v_user;
  insert into _smoke values (3, '6c 阅读 quota_consumed=true 计 +1', v_import = 1, '导入=' || v_import);

  -- 6d. 软删该阅读 → 导入计数不回退（A2：终身单调、删书只释放「同时在读」槽位）
  update public.readings set deleted_at = now() where id = '__smoke_reading2__';
  select import_lifetime_count into v_import from public.user_quotas where user_id = v_user;
  insert into _smoke values (4, '6d 软删不释放（仍=1）', v_import = 1, '导入=' || v_import);

  -- 清理冒烟测试行
  delete from public.bookmarks where id in ('__smoke_bookmark__', '__smoke_bookmark2__');
  delete from public.readings   where id in ('__smoke_reading__', '__smoke_reading2__');

  -- 恢复基线
  delete from public.user_quotas where user_id = v_user;
  if v_quota.user_id is not null then
    insert into public.user_quotas(user_id, import_lifetime_count, bookmark_week_start, bookmark_week_count, updated_at)
    values (v_quota.user_id, v_quota.import_lifetime_count, v_quota.bookmark_week_start, v_quota.bookmark_week_count, v_quota.updated_at);
  end if;
  delete from public.subscriptions where user_id = v_user;
  if v_sub.user_id is not null then
    insert into public.subscriptions(user_id, pro_expires_at, pro_source, created_at, updated_at)
    values (v_sub.user_id, v_sub.pro_expires_at, v_sub.pro_source, v_sub.created_at, v_sub.updated_at);
  end if;
  delete from public.user_first_reading_states where user_id = v_user;
  if v_state.user_id is not null then
    insert into public.user_first_reading_states(user_id, status, selected_submission_id, selected_reading_id, handled_at, created_at, updated_at)
    values (v_state.user_id, v_state.status, v_state.selected_submission_id, v_state.selected_reading_id, v_state.handled_at, v_state.created_at, v_state.updated_at);
  end if;
end $$;

select seq, label, case when ok then 'PASS' else 'FAIL' end as result, detail from _smoke order by seq;


-- ════════════════════════════════════════════════════════════════════════════
-- STEP 7 · Pro 到期回退（验收 #6）：身份回 free + 约束恢复 + 存量保留
-- 验证点：7a 到期身份回退（pro_expires_at 过期 → plan='free'）；
--         7b Pro 期间存量保留 + 计数不烧（Pro 时导入不计额度、到期后内容仍在）；
--         7c 到期后导入约束恢复（额度已满 → Q0001）；
--         7d 到期后收藏约束恢复（额度已满 → Q0002）
-- 说明：方案 A（Pro 不占额度）下不存在「超额存量」——Pro 期间使用不烧 Free 额度，
--       到期后额度从升级前继续，故「存量保留」= 无清理机制、内容与计数都在。
-- ════════════════════════════════════════════════════════════════════════════
create temp table if not exists _smoke(seq int, label text, ok boolean, detail text);
delete from _smoke;

do $$
declare
  v_user uuid := (
    select u.id from auth.users u
    where exists (select 1 from public.profiles p where p.user_id = u.id)
    order by u.created_at desc limit 1
  );
  v_sub   public.subscriptions;
  v_quota public.user_quotas;
  v_state public.user_first_reading_states;
  v_result jsonb;
  v_limit int;
  v_import int;
  v_exists bool;
begin
  if v_user is null then
    insert into _smoke values (0, '前置检查', false, '未找到「有 profile 的账号」，请先在应用里注册/登录');
    return;
  end if;
  insert into _smoke values (0, '测试账号', true, v_user::text);

  -- 快照基线
  select * into v_sub   from public.subscriptions where user_id = v_user;
  select * into v_quota from public.user_quotas    where user_id = v_user;
  select * into v_state from public.user_first_reading_states where user_id = v_user;

  -- 重置为 Free + 额度清零
  insert into public.subscriptions(user_id) values (v_user)
    on conflict (user_id) do update set pro_expires_at = null;
  insert into public.user_quotas(user_id, import_lifetime_count, bookmark_week_count, bookmark_week_start)
    values (v_user, 0, 0, null)
    on conflict (user_id) do update set import_lifetime_count = 0, bookmark_week_count = 0, bookmark_week_start = null;

  -- 清理可能残留的冒烟测试行
  delete from public.bookmarks where id = '__smoke_bookmark__';
  delete from public.readings   where id = '__smoke_reading__';

  -- 模拟登录会话（7a 的 get_subscription_status 需要 auth.uid()）
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  -- 7a. 到期身份回退：pro_expires_at 拨到过去 → plan 应回 'free'、proExpiresAt 为 null
  update public.subscriptions set pro_expires_at = now() - interval '1 day' where user_id = v_user;
  select public.get_subscription_status() into v_result;
  insert into _smoke values (1, '7a 到期身份回退 plan=free',
    (v_result->>'plan') = 'free' and (v_result->>'proExpiresAt') is null,
    v_result::text);

  -- 7b. Pro 期间存量保留 + 计数不烧：Pro 时插入阅读（不计额度），到期后该阅读仍在、计数仍 0
  update public.subscriptions set pro_expires_at = now() + interval '30 days' where user_id = v_user;
  insert into public.readings (id, user_id, title, quota_consumed)
    values ('__smoke_reading__', v_user, 'Pro 期间导入', true);
  select import_lifetime_count into v_import from public.user_quotas where user_id = v_user;
  update public.subscriptions set pro_expires_at = now() - interval '1 day' where user_id = v_user;
  select exists(select 1 from public.readings where id = '__smoke_reading__' and deleted_at is null) into v_exists;
  insert into _smoke values (2, '7b Pro 期间存量保留 + 计数不烧',
    v_import = 0 and v_exists,
    'Pro 期导入计数=' || v_import || '；到期后阅读仍在=' || v_exists);

  -- 7c. 到期后导入约束恢复：额度拨满 → Q0001（不再豁免）
  select coalesce(import_free_limit, 30) into v_limit from public.subscription_config where id = true;
  update public.user_quotas set import_lifetime_count = v_limit where user_id = v_user;
  begin
    perform public.consume_import_quota(v_user);
    insert into _smoke values (3, '7c 到期后导入约束恢复 Q0001', false, '未触发异常');
  exception when others then
    insert into _smoke values (3, '7c 到期后导入约束恢复 Q0001', sqlerrm like '%导入额度已用完%', sqlerrm);
  end;

  -- 7d. 到期后收藏约束恢复：额度拨满（本周）→ Q0002（不再豁免）
  select coalesce(bookmark_week_limit, 30) into v_limit from public.subscription_config where id = true;
  update public.user_quotas
     set bookmark_week_count = v_limit,
         bookmark_week_start = date_trunc('week', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'
   where user_id = v_user;
  begin
    perform public.consume_bookmark_quota(v_user);
    insert into _smoke values (4, '7d 到期后收藏约束恢复 Q0002', false, '未触发异常');
  exception when others then
    insert into _smoke values (4, '7d 到期后收藏约束恢复 Q0002', sqlerrm like '%收藏额度已用完%', sqlerrm);
  end;

  -- 清理冒烟测试行
  delete from public.bookmarks where id = '__smoke_bookmark__';
  delete from public.readings   where id = '__smoke_reading__';

  -- 恢复基线
  delete from public.user_quotas where user_id = v_user;
  if v_quota.user_id is not null then
    insert into public.user_quotas(user_id, import_lifetime_count, bookmark_week_start, bookmark_week_count, updated_at)
    values (v_quota.user_id, v_quota.import_lifetime_count, v_quota.bookmark_week_start, v_quota.bookmark_week_count, v_quota.updated_at);
  end if;
  delete from public.subscriptions where user_id = v_user;
  if v_sub.user_id is not null then
    insert into public.subscriptions(user_id, pro_expires_at, pro_source, created_at, updated_at)
    values (v_sub.user_id, v_sub.pro_expires_at, v_sub.pro_source, v_sub.created_at, v_sub.updated_at);
  end if;
  delete from public.user_first_reading_states where user_id = v_user;
  if v_state.user_id is not null then
    insert into public.user_first_reading_states(user_id, status, selected_submission_id, selected_reading_id, handled_at, created_at, updated_at)
    values (v_state.user_id, v_state.status, v_state.selected_submission_id, v_state.selected_reading_id, v_state.handled_at, v_state.created_at, v_state.updated_at);
  end if;
end $$;

select seq, label, case when ok then 'PASS' else 'FAIL' end as result, detail from _smoke order by seq;

-- 收尾：可删掉临时表（可选，不影响）
-- drop table if exists _smoke;
