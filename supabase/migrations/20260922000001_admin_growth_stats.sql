-- ============================================================================
-- Migration: 后台数据统计（用户增长与使用）
-- 日期: 2026-09-22
-- 说明: 新增 admin_get_growth_stats RPC，为后台「数据统计」页提供：
--         - snapshot: 用户总量 / 今日新增 / DAU / WAU / MAU
--         - series:   新增注册 / 累计用户 / 活跃用户(近似) / 阅读活跃三线，按日/周/月
--         - retention: d1 / d7 / d30（产出近似 + 滚动 cohort）
--       活跃与留存采用「有产出行为（新增阅读或收藏）」近似口径，
--       因 profiles.last_seen_at 为覆盖式时间戳、无法回溯历史；
--       「有产出」按「是否发生过」计：不因后续删除（deleted_at）或归档（status='archived'）排除。
--       聚合走 SECURITY DEFINER（readings/bookmarks 无 admin select 策略）。
--       时区：函数级 SET timezone = 'Asia/Shanghai'（进入函数生效、退出恢复），使今日/本周/本月对齐管理员本地日历。
-- 执行方式: Dashboard SQL Editor 手动执行（无本地 CLI）
-- ============================================================================

begin;

CREATE OR REPLACE FUNCTION public.admin_get_growth_stats(
  p_granularity text DEFAULT 'day',
  p_window_days int DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone = 'Asia/Shanghai'
AS $$
DECLARE
  v_granularity text := p_granularity;
  v_interval interval;
  v_axis_start timestamptz;
  v_axis_end timestamptz;
  v_baseline bigint;
  v_total_users bigint;
  v_today_new bigint;
  v_dau bigint;
  v_wau bigint;
  v_mau bigint;
  v_series jsonb;
  v_retention jsonb;
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION '无管理员权限' USING ERRCODE = '42501';
  END IF;

  IF v_granularity NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'granularity 须为 day/week/month';
  END IF;

  v_interval := CASE v_granularity
    WHEN 'day' THEN INTERVAL '1 day'
    WHEN 'week' THEN INTERVAL '1 week'
    WHEN 'month' THEN INTERVAL '1 month'
  END;

  v_axis_end := date_trunc(v_granularity, now());
  v_axis_start := date_trunc(v_granularity, now() - make_interval(days => greatest(p_window_days - 1, 1)));

  -- ── 快照 ──────────────────────────────────────────────
  SELECT count(*) INTO v_total_users FROM public.profiles;

  SELECT count(*) INTO v_today_new
  FROM public.profiles
  WHERE created_at >= date_trunc('day', now());

  SELECT count(*) INTO v_dau
  FROM public.profiles
  WHERE last_seen_at >= now() - INTERVAL '1 day';

  SELECT count(*) INTO v_wau
  FROM public.profiles
  WHERE last_seen_at >= now() - INTERVAL '7 days';

  SELECT count(*) INTO v_mau
  FROM public.profiles
  WHERE last_seen_at >= now() - INTERVAL '30 days';

  -- ── 序列（时间轴 + 各桶聚合 + 累计）────────────────────
  -- 累计用户 = 窗口前的存量 + 窗口内逐桶累加
  SELECT count(*) INTO v_baseline
  FROM public.profiles
  WHERE created_at < v_axis_start;

  WITH axis AS (
    SELECT generate_series(v_axis_start, v_axis_end, v_interval)::date AS bucket
  ),
  new_users AS (
    SELECT date_trunc(v_granularity, created_at)::date AS bucket, count(*) AS n
    FROM public.profiles
    WHERE created_at >= v_axis_start
    GROUP BY 1
  ),
  activity AS (
    SELECT user_id, created_at FROM public.readings
    UNION ALL
    SELECT user_id, created_at FROM public.bookmarks
  ),
  active_users AS (
    SELECT date_trunc(v_granularity, created_at)::date AS bucket, count(DISTINCT user_id) AS n
    FROM activity
    WHERE created_at >= v_axis_start
    GROUP BY 1
  ),
  reading_started AS (
    SELECT date_trunc(v_granularity, reading_started_at)::date AS bucket, count(*) AS n
    FROM public.readings
    WHERE reading_started_at IS NOT NULL AND reading_started_at >= v_axis_start
    GROUP BY 1
  ),
  reading_finished AS (
    SELECT date_trunc(v_granularity, reading_finished_at)::date AS bucket, count(*) AS n
    FROM public.readings
    WHERE reading_finished_at IS NOT NULL AND reading_finished_at >= v_axis_start
    GROUP BY 1
  ),
  new_readings AS (
    SELECT date_trunc(v_granularity, created_at)::date AS bucket, count(*) AS n
    FROM public.readings
    WHERE created_at >= v_axis_start
    GROUP BY 1
  ),
  joined AS (
    SELECT
      a.bucket,
      coalesce(nu.n, 0) AS new_users,
      coalesce(au.n, 0) AS active_users,
      coalesce(rs.n, 0) AS reading_started,
      coalesce(rf.n, 0) AS reading_finished,
      coalesce(nr.n, 0) AS new_readings
    FROM axis a
    LEFT JOIN new_users nu ON nu.bucket = a.bucket
    LEFT JOIN active_users au ON au.bucket = a.bucket
    LEFT JOIN reading_started rs ON rs.bucket = a.bucket
    LEFT JOIN reading_finished rf ON rf.bucket = a.bucket
    LEFT JOIN new_readings nr ON nr.bucket = a.bucket
  ),
  cum AS (
    SELECT j.*,
           v_baseline + sum(j.new_users) OVER (ORDER BY j.bucket) AS cumulative_users
    FROM joined j
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'bucket', bucket,
      'new_users', new_users,
      'cumulative_users', cumulative_users,
      'active_users', active_users,
      'reading_started', reading_started,
      'reading_finished', reading_finished,
      'new_readings', new_readings
    ) ORDER BY bucket
  )
  INTO v_series
  FROM cum;

  -- ── 留存（d1/d7/d30，产出近似 + 滚动 cohort）───────────
  WITH horizons(d) AS (VALUES (1), (7), (30)),
  activity AS (
    SELECT user_id, created_at FROM public.readings
    UNION ALL
    SELECT user_id, created_at FROM public.bookmarks
  ),
  rows AS (
    SELECT
      h.d,
      (SELECT count(*) FROM public.profiles p
        WHERE p.created_at >= now() - make_interval(days => h.d + 7)
          AND p.created_at <  now() - make_interval(days => h.d)) AS cohort_size,
      (SELECT count(DISTINCT p.user_id)
        FROM public.profiles p
        JOIN activity a ON a.user_id = p.user_id
        WHERE p.created_at >= now() - make_interval(days => h.d + 7)
          AND p.created_at <  now() - make_interval(days => h.d)
          AND a.created_at >= p.created_at
          AND a.created_at <  p.created_at + make_interval(days => h.d)) AS retained
    FROM horizons h
  )
  SELECT jsonb_object_agg(
    'd' || d::text,
    CASE WHEN cohort_size = 0 THEN 0
         ELSE round(100.0 * retained / cohort_size, 1) END
  )
  INTO v_retention
  FROM rows;

  RETURN jsonb_build_object(
    'snapshot', jsonb_build_object(
      'total_users', v_total_users,
      'today_new_users', v_today_new,
      'dau', v_dau,
      'wau', v_wau,
      'mau', v_mau
    ),
    'series', coalesce(v_series, '[]'::jsonb),
    'retention', v_retention
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_growth_stats(text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_growth_stats(text, int) TO authenticated;

notify pgrst, 'reload schema';

commit;
