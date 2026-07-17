import { useEffect } from 'react'

/**
 * 推荐详情弹窗 — 方案2
 * 展示卡片表面之外的信息：作者/来源、关键词、原文摘录（中英对照）
 */
export default function RecommendationDetailModal({ rec, onClose }) {
  // 解析来源域名
  let sourceHostname = null
  if (rec.sourceUrl) {
    try { sourceHostname = new URL(rec.sourceUrl).hostname } catch (_) { /* ignore */ }
  }

  // ESC 关闭
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const hasMeta = rec.author || sourceHostname
  const hasKeywords = (rec.keywordsTrans && rec.keywordsTrans.length > 0) || (rec.keywords && rec.keywords.length > 0)
  const displayKeywords = rec.keywordsTrans && rec.keywordsTrans.length > 0 ? rec.keywordsTrans : rec.keywords
  const hasExcerpts = (rec.excerptsTrans && rec.excerptsTrans.length > 0) || (rec.excerpts && rec.excerpts.length > 0)
  // 优先展示英文原文，翻译作为辅助展示在下方
const displayExcerpts = rec.excerpts && rec.excerpts.length > 0 ? rec.excerpts : rec.excerptsTrans

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: 'rgba(28,25,23,0.40)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="rounded-[22px] w-full animate-pop-in"
        style={{
          maxWidth: '500px',
          maxHeight: '85vh',
          overflowY: 'auto',
          background: 'var(--popup-bg)',
          boxShadow: 'var(--popup-shadow)',
          margin: '16px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '24px' }}>

          {/* ─── 作者 & 来源 ─── */}
          {hasMeta && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{
                fontSize: '10px', fontFamily: 'DM Sans', fontWeight: 600,
                color: 'var(--ink-muted)', textTransform: 'uppercase',
                letterSpacing: '0.07em', marginBottom: '8px',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}>
                <span style={{ opacity: 0.7 }}>✍️</span> 作者 & 来源
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)',
              }}>
                {rec.author && (
                  <>
                    <span style={{ fontWeight: 500, color: 'var(--ink)', opacity: 0.65, fontSize: '12.5px' }}>
                      {rec.author}
                    </span>
                    {sourceHostname && (
                      <span style={{
                        width: '2.5px', height: '2.5px', borderRadius: '50%',
                        background: 'var(--meta-sep-color)',
                      }} />
                    )}
                  </>
                )}
                {sourceHostname && (
                  <a href={rec.sourceUrl} target="_blank" rel="noopener noreferrer"
                    style={{ opacity: 0.55, fontSize: '12px', color: 'var(--gold-dark)', textDecoration: 'none' }}>
                    {sourceHostname} ↗
                  </a>
                )}
              </div>
            </div>
          )}

          {/* ─── 关键词 ─── */}
          {hasKeywords && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{
                fontSize: '10px', fontFamily: 'DM Sans', fontWeight: 600,
                color: 'var(--ink-muted)', textTransform: 'uppercase',
                letterSpacing: '0.07em', marginBottom: '6px',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}>
                <span style={{ opacity: 0.7 }}>🏷️</span> 关键词
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                {displayKeywords.map((kw, i) => (
                  <span key={i} style={{
                    fontSize: '10.5px', fontFamily: 'DM Sans', fontWeight: 450,
                    color: 'var(--gold-dark)', background: 'rgba(196,154,60,0.12)',
                    borderRadius: '100px', padding: '3px 10px',
                    letterSpacing: '0.02em',
                  }}>
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ─── 分隔线（关键词/作者 → 摘录） ─── */}
          {(hasMeta || hasKeywords) && hasExcerpts && (
            <div style={{
              height: '1px', background: 'var(--border-subtle)',
              margin: '16px 0',
            }} />
          )}

          {/* ─── 摘录（多条） ─── */}
          {hasExcerpts && (
            <div>
              <div style={{
                fontSize: '10px', fontFamily: 'DM Sans', fontWeight: 600,
                color: 'var(--ink-muted)', textTransform: 'uppercase',
                letterSpacing: '0.07em', marginBottom: '8px',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}>
                <span style={{ opacity: 0.7 }}>💬</span> 摘录{displayExcerpts.length > 1 ? `（${displayExcerpts.length} 条）` : ''}
              </div>
              <div style={{
                paddingLeft: '14px',
                borderLeft: '2.5px solid rgba(196,154,60,0.28)',
              }}>
                {displayExcerpts.map((ex, i) => (
                  <div key={i} style={{ marginBottom: i < displayExcerpts.length - 1 ? '14px' : 0 }}>
                    <p style={{
                      fontFamily: '"Lora", Georgia, serif', fontSize: '13.5px',
                      fontStyle: 'italic', color: 'var(--ink-light)',
                      lineHeight: 1.8, marginBottom: 0,
                    }}>
                      "{ex}"
                    </p>
                    {/* 如有对应翻译，展示之 */}
                    {rec.excerptsTrans && rec.excerptsTrans[i] && (
                      <p style={{
                        fontFamily: 'DM Sans', fontSize: '12.5px',
                        color: 'var(--ink-muted)', lineHeight: 1.7,
                        opacity: 0.85, marginTop: '4px',
                      }}>
                        {rec.excerptsTrans[i]}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
