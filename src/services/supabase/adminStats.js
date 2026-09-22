import { getSupabaseClient } from './client'

/** 后台数据统计：快照 + 序列 + 留存（近似口径）。 */
export async function getGrowthStats({ granularity = 'day', windowDays = 90 } = {}) {
  const { data, error } = await getSupabaseClient().rpc('admin_get_growth_stats', {
    p_granularity: granularity,
    p_window_days: windowDays,
  })

  if (error) throw error
  return data
}
