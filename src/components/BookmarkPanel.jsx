import { X, Trash2, HeartOff, Loader2 } from 'lucide-react'
import { highlightWord } from '../utils/textUtils'

const TYPE_LABEL = { word: '词', phrase: '句', sentence: '句', paragraph: '段' }
const TYPE_DOT = {
  word: '#fbbf24',
  phrase: '#34d399',
  sentence: '#818cf8',
  paragraph: '#818cf8',
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export default function BookmarkPanel({ open, bookmarks, onClose, onDelete, onJump }) {
  return (
    <>
      {/* Backdrop (mobile) */}
      {open && (
        <div
          className="fixed inset-0 z-30"
          style={{ background: 'rgba(28,25,23,0.15)' }}
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full z-40 flex flex-col"
        style={{
          width: '300px',
          background: '#fdfaf5',
          borderLeft: '1px solid rgba(28,25,23,0.09)',
          boxShadow: open ? '-8px 0 32px rgba(28,25,23,0.1)' : 'none',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.28s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid rgba(28,25,23,0.08)' }}
        >
          <div className="flex items-center gap-2">
            <span
              style={{
                fontFamily: '"Playfair Display", Georgia, serif',
                fontSize: '16px',
                fontWeight: 600,
                color: 'var(--ink)',
              }}
            >
              收藏
            </span>
            {bookmarks.length > 0 && (
              <span
                style={{
                  fontSize: '11px',
                  fontFamily: 'DM Sans',
                  background: 'var(--ink)',
                  color: '#fff',
                  borderRadius: '10px',
                  padding: '1px 7px',
                  fontWeight: 500,
                }}
              >
                {bookmarks.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded-xl transition-all"
            style={{
              width: 30,
              height: 30,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--ink-muted)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(28,25,23,0.06)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <X size={15} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {bookmarks.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center h-full gap-3"
              style={{ paddingBottom: '60px' }}
            >
              <HeartOff size={32} style={{ color: 'rgba(28,25,23,0.15)' }} />
              <p
                style={{
                  fontSize: '13px',
                  fontFamily: 'DM Sans',
                  color: 'var(--ink-muted)',
                  opacity: 0.6,
                  textAlign: 'center',
                  lineHeight: 1.6,
                }}
              >
                还没有收藏
                <br />
                划选文本后点击收藏按钮
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  className="group rounded-2xl cursor-pointer transition-all"
                  style={{
                    background: '#fff',
                    border: '1px solid rgba(28,25,23,0.07)',
                    padding: '12px 14px',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(196,154,60,0.35)'
                    e.currentTarget.style.boxShadow = '0 2px 10px rgba(28,25,23,0.07)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(28,25,23,0.07)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                  onClick={() => onJump(bm.paragraphIndex)}
                >
                  {/* Type badge + date */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: TYPE_DOT[bm.type] ?? '#fbbf24',
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontSize: '10px',
                          fontFamily: 'DM Sans',
                          color: 'var(--ink-muted)',
                          letterSpacing: '0.07em',
                          textTransform: 'uppercase',
                          fontWeight: 500,
                        }}
                      >
                        {TYPE_LABEL[bm.type] ?? '收藏'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        style={{
                          fontSize: '11px',
                          fontFamily: 'DM Sans',
                          color: 'var(--ink-muted)',
                          opacity: 0.5,
                        }}
                      >
                        {formatDate(bm.createdAt)}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(bm.id)
                        }}
                        className="opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-lg transition-all"
                        style={{
                          width: 22,
                          height: 22,
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--ink-muted)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#fee2e2'
                          e.currentTarget.style.color = '#dc2626'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent'
                          e.currentTarget.style.color = 'var(--ink-muted)'
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  {/* 原词（斜体小字） */}
                  <p
                    style={{
                      fontFamily: '"Lora", Georgia, serif',
                      fontSize: '12px',
                      fontStyle: 'italic',
                      color: 'var(--ink-muted)',
                      lineHeight: 1.4,
                      marginBottom: '5px',
                    }}
                  >
                    {bm.text}
                  </p>

                  {/* 翻译（主，大字） */}
                  {bm.translationStatus === 'pending' ? (
                    <div className="flex items-center gap-1.5" style={{ marginBottom: bm.contextSentence ? '6px' : 0 }}>
                      <Loader2 size={11} className="animate-spin" style={{ color: 'rgba(28,25,23,0.2)' }} />
                      <span style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'rgba(28,25,23,0.3)' }}>翻译生成中…</span>
                    </div>
                  ) : bm.translation ? (
                    <p
                      style={{
                        fontFamily: 'DM Sans',
                        fontSize: '16px',
                        fontWeight: 600,
                        color: 'var(--ink)',
                        lineHeight: 1.3,
                        marginBottom: bm.contextSentence ? '6px' : 0,
                      }}
                    >
                      {bm.translation}
                    </p>
                  ) : null}

                  {/* 语境句原文（斜体，词加粗） */}
                  {bm.contextSentence && (() => {
                    const { before, match, after } = highlightWord(bm.contextSentence, bm.text)
                    return (
                      <p
                        style={{
                          fontFamily: '"Lora", Georgia, serif',
                          fontSize: '11px',
                          fontStyle: 'italic',
                          color: 'var(--ink-light)',
                          lineHeight: 1.55,
                          marginBottom: bm.contextTranslation ? '3px' : 0,
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {before}
                        {match && <strong style={{ color: 'var(--ink)', fontStyle: 'italic', fontWeight: 700 }}>{match}</strong>}
                        {after}
                      </p>
                    )
                  })()}

                  {/* 句子译文（辅助） */}
                  {bm.contextTranslation && (
                    <p
                      style={{
                        fontFamily: 'DM Sans',
                        fontSize: '11px',
                        color: 'var(--ink-muted)',
                        lineHeight: 1.5,
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        opacity: 0.7,
                      }}
                    >
                      {bm.contextTranslation}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {bookmarks.length > 0 && (
          <div
            className="shrink-0 px-4 py-3"
            style={{ borderTop: '1px solid rgba(28,25,23,0.07)' }}
          >
            <p
              style={{
                fontSize: '11px',
                fontFamily: 'DM Sans',
                color: 'var(--ink-muted)',
                textAlign: 'center',
                opacity: 0.5,
              }}
            >
              点击卡片跳转原文位置
            </p>
          </div>
        )}
      </div>
    </>
  )
}
