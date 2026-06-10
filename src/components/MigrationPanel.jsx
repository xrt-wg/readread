import { useMemo, useState } from 'react'
import { ArrowRight, Database, TriangleAlert } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import {
  buildLocalMigrationContract,
  prepareLocalMigration,
} from '../services/migration/localMigration'
import { runRemoteMigration } from '../services/migration/remoteMigration'

function MappingList({ title, items }) {
  return (
    <div className="space-y-2 rounded-2xl border border-stone-900/10 bg-white/80 p-4">
      <div className="text-sm font-medium text-stone-800">{title}</div>
      <div className="space-y-1 text-xs text-stone-600">
        {items.map(([from, to]) => (
          <div key={`${title}-${from}-${to}`} className="flex items-center justify-between gap-3">
            <span className="truncate">{from}</span>
            <ArrowRight size={12} className="shrink-0 text-stone-400" />
            <span className="truncate text-stone-900">{to}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MigrationPanel() {
  const { refreshAuthState, userId } = useAuth()
  const [isDeferred, setIsDeferred] = useState(false)
  const [prepareState, setPrepareState] = useState({
    phase: 'idle',
    result: null,
  })
  const contract = useMemo(() => buildLocalMigrationContract(userId), [userId])

  function handlePrepareMigration() {
    setPrepareState({
      phase: 'checking',
      result: null,
    })

    const result = prepareLocalMigration(userId)

    setPrepareState({
      phase: result.phase,
      result,
    })
  }

  async function handleRunMigration() {
    setPrepareState((currentState) => ({
      ...currentState,
      phase: 'running',
    }))

    const result = await runRemoteMigration(userId)

    setPrepareState({
      phase: result.phase,
      result,
    })

    if (result.phase === 'completed') {
      refreshAuthState()
    }
  }

  if (!contract.summary.hasData) {
    return null
  }

  if (isDeferred) {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-20">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <span>当前设备仍有待迁移历史数据，后续进入关键节点时会继续提醒。</span>
            <button
              type="button"
              onClick={() => setIsDeferred(false)}
              className="shrink-0 rounded-xl border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 transition hover:bg-amber-100"
            >
              重新查看
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pt-20">
      <div className="rounded-[28px] border border-amber-200 bg-[rgba(255,251,235,0.94)] p-5 shadow-[0_18px_50px_rgba(120,53,15,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
              <Database size={16} />
              <span>检测到本地历史数据待迁移</span>
            </div>
            <div className="max-w-2xl text-sm text-amber-900/90">
              当前账号已完成认证，但本设备仍存在历史文章、收藏或阅读进度。根据迁移方案，系统会先固定迁移输入、展示映射关系并做预检查，再进入正式迁移写入。
            </div>
            <div className="text-xs text-amber-800/80">
              当前账号：{userId || '未识别'}
            </div>
          </div>
          <div className="grid min-w-[220px] grid-cols-3 gap-2 rounded-2xl bg-white/80 p-3 text-center">
            <div>
              <div className="text-lg font-semibold text-stone-900">{contract.summary.articleCount}</div>
              <div className="text-xs text-stone-500">文章</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-stone-900">{contract.summary.bookmarkCount}</div>
              <div className="text-xs text-stone-500">收藏</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-stone-900">{contract.summary.readingMarkCount}</div>
              <div className="text-xs text-stone-500">阅读进度</div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-stone-900/10 bg-white/80 p-4">
              <div className="text-sm font-medium text-stone-800">迁移顺序</div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-700">
                {contract.stepOrder.map((step, index) => (
                  <div key={step} className="flex items-center gap-2">
                    <span className="rounded-full bg-stone-900 px-2 py-1 text-white">{index + 1}</span>
                    <span>{step}</span>
                    {index < contract.stepOrder.length - 1 ? <ArrowRight size={12} className="text-stone-400" /> : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <MappingList title="articles" items={contract.mappings.articles} />
              <MappingList title="bookmarks" items={contract.mappings.bookmarks} />
              <MappingList title="readingMarks" items={contract.mappings.readingMarks} />
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-stone-900/10 bg-white/80 p-4">
              <div className="text-sm font-medium text-stone-800">预检查结果</div>
              <div className="mt-3 text-sm text-stone-700">
                {prepareState.phase === 'idle'
                  ? '点击“开始迁移”后将执行正式预检查。'
                  : prepareState.phase === 'checking'
                    ? '正在执行迁移预检查...'
                    : prepareState.phase === 'running'
                      ? '正在按既定顺序执行迁移写入，请勿关闭页面。'
                    : prepareState.result?.validation?.isValid
                      ? '预检查通过，当前已具备进入正式迁移写入阶段的前置条件。'
                      : '预检查未通过，正式迁移已被阻断，请先修复以下问题后重试。'}
              </div>
              {prepareState.result?.validation?.errors?.length > 0 ? (
                <div className="mt-3 space-y-2 rounded-2xl bg-red-50 p-3 text-xs text-red-700">
                  {prepareState.result.validation.errors.map((item) => (
                    <div key={item} className="flex items-start gap-2">
                      <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {prepareState.phase === 'ready' ? (
                <div className="mt-3 rounded-2xl bg-emerald-50 p-3 text-xs text-emerald-700">
                  迁移快照已固定，预检查通过。下一步将开始按 `articles → bookmarks → reading_marks` 的顺序执行真实写库迁移。
                </div>
              ) : null}
              {prepareState.phase === 'completed' ? (
                <div className="mt-3 rounded-2xl bg-emerald-50 p-3 text-xs text-emerald-700 space-y-1">
                  <div>迁移已完成，系统已写回首次迁移状态。</div>
                  <div>articles：{prepareState.result?.results?.articles?.success ?? 0}</div>
                  <div>bookmarks：{prepareState.result?.results?.bookmarks?.success ?? 0}</div>
                  <div>readingMarks：{prepareState.result?.results?.readingMarks?.success ?? 0}</div>
                  <div>数量校验：{prepareState.result?.summaryCheck?.articles && prepareState.result?.summaryCheck?.bookmarks && prepareState.result?.summaryCheck?.readingMarks ? '通过' : '未通过'}</div>
                </div>
              ) : null}
              {prepareState.phase === 'failed' && prepareState.result?.error ? (
                <div className="mt-3 rounded-2xl bg-red-50 p-3 text-xs text-red-700 space-y-1">
                  <div>{prepareState.result.error.message || '迁移失败，请稍后重试'}</div>
                  <div>失败阶段：{prepareState.result.failedStep || 'unknown'}</div>
                  {prepareState.result.failureSummary?.total > 0 ? (
                    <div>
                      失败汇总：articles {prepareState.result.failureSummary.articles} / bookmarks {prepareState.result.failureSummary.bookmarks} / readingMarks {prepareState.result.failureSummary.readingMarks}
                    </div>
                  ) : null}
                  <div>本地原始数据仍然保留，可直接重试。</div>
                </div>
              ) : null}
              {prepareState.result?.warnings?.length > 0 ? (
                <div className="mt-3 rounded-2xl bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                  <div className="font-medium">迁移提示</div>
                  {prepareState.result.warnings.map((item) => (
                    <div key={item}>{item}</div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-stone-900/10 bg-white/80 p-4 text-sm text-stone-700">
              当前阶段已完成：
              <div className="mt-2 space-y-1 text-xs text-stone-600">
                <div>- 确认迁移输入来源仍为 `rr_articles`、`rr_bookmarks`、`rr_reading_marks`</div>
                <div>- 建立本地字段到云端字段的映射契约</div>
                <div>- 建立迁移快照与最小预检查能力</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={prepareState.phase === 'ready' ? handleRunMigration : handlePrepareMigration}
                disabled={prepareState.phase === 'checking' || prepareState.phase === 'running' || prepareState.phase === 'completed'}
                className="rounded-2xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition disabled:cursor-default disabled:bg-stone-500"
              >
                {prepareState.phase === 'checking'
                  ? '预检查中...'
                  : prepareState.phase === 'running'
                    ? '迁移执行中...'
                    : prepareState.phase === 'completed'
                      ? '迁移已完成'
                  : prepareState.phase === 'ready'
                    ? '确认开始迁移'
                    : prepareState.phase === 'failed'
                      ? '重新预检查'
                      : '开始迁移'}
              </button>
              <button
                type="button"
                onClick={() => setIsDeferred(true)}
                className="rounded-2xl border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-100"
              >
                稍后处理
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
