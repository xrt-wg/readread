import { memo } from 'react'
import { ArrowLeft, Bookmark, Moon, ScanEye, Star, Sun, Type, Minus, Plus } from 'lucide-react'

const ReaderHeader = memo(function ReaderHeader({
  headerVisible, onBack, scrollPercentTextRef, progressRingRef, paginated,
  tocOpen, setTocOpen, currentChapterIdx, chapters,
  readingMark, handleJumpToReadingMark,
  panelOpen, setPanelOpen, bookmarks,
  preReadMode, onTogglePreRead,
  theme, toggleTheme,
  fontSize, setFontSize, fontSizeOpen, setFontSizeOpen, fontSizeRef,
}) {
  return (
    <header
      className="sticky top-0 z-40 flex items-center justify-between px-5 py-2.5"
      style={{
        background: 'var(--parchment)',
        borderBottom: '1px solid var(--border-subtle)',
        position: 'sticky',
        transform: headerVisible ? 'translateY(0)' : 'translateY(-100%)',
        opacity: headerVisible ? 1 : 0,
        pointerEvents: headerVisible ? 'auto' : 'none',
        transition: 'transform 0.3s ease, opacity 0.3s ease',
      }}
    >
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-all"
        style={{
          fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)',
          background: 'transparent', border: 'none', cursor: 'pointer',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; e.currentTarget.style.color = 'var(--ink)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}
      >
        <ArrowLeft size={13} />
      </button>

      <div className="flex items-center gap-1.5">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}
        >
          <circle
            cx="12" cy="12" r="9"
            fill="none"
            stroke="var(--border-subtle)"
            strokeWidth="2"
          />
          <circle
            ref={progressRingRef}
            cx="12" cy="12" r="9"
            fill="none"
            stroke="var(--gold)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 9}
            strokeDashoffset={2 * Math.PI * 9}
          />
        </svg>
        <span ref={scrollPercentTextRef} style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)' }}>
          0%
        </span>
        {paginated && (
          <button
            onClick={() => setTocOpen(v => !v)}
            title="目录"
            style={{
              fontSize: '10px', fontFamily: 'DM Sans', fontWeight: 500,
              background: tocOpen ? 'var(--ink)' : 'var(--surface-bg)',
              color: tocOpen ? '#fff' : 'var(--ink-muted)',
              border: `1px solid ${tocOpen ? 'var(--ink)' : 'var(--surface-border)'}`,
              borderRadius: '7px', padding: '2px 7px', cursor: 'pointer',
            }}
          >
            目录 · {currentChapterIdx + 1}/{chapters.length}
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button onClick={handleJumpToReadingMark} disabled={!readingMark || readingMark.completed}
          title="跳转到阅读位置" className="flex items-center justify-center rounded-lg transition-all"
          style={{
            width: 30, height: 30, background: 'transparent',
            border: `1px solid ${readingMark && !readingMark.completed ? 'rgba(196,154,60,0.4)' : 'var(--border-subtle)'}`,
            cursor: readingMark && !readingMark.completed ? 'pointer' : 'default',
            color: readingMark && !readingMark.completed ? 'var(--gold)' : 'var(--ink-muted)',
          }}
        >
          <Bookmark size={12} fill={readingMark && !readingMark.completed ? 'currentColor' : 'none'} />
        </button>

        <button onClick={() => setPanelOpen(v => !v)} title="收藏"
          className="relative flex items-center justify-center rounded-lg transition-all"
          style={{
            width: 30, height: 30,
            background: panelOpen ? 'var(--ink)' : 'var(--surface-bg)',
            border: `1px solid ${panelOpen ? 'var(--ink)' : 'var(--surface-border)'}`,
            cursor: 'pointer', color: panelOpen ? '#fff' : 'var(--ink-muted)',
          }}
          onMouseEnter={(e) => { if (!panelOpen) { e.currentTarget.style.borderColor = 'rgba(196,154,60,0.5)'; e.currentTarget.style.color = 'var(--ink)' } }}
          onMouseLeave={(e) => { if (!panelOpen) { e.currentTarget.style.borderColor = 'var(--surface-border)'; e.currentTarget.style.color = 'var(--ink-muted)' } }}
        >
          <Star size={12} />
          {bookmarks.length > 0 && (
            <span style={{ position: 'absolute', top: -4, right: -6, fontSize: '9px', fontWeight: 600,
              background: panelOpen ? 'rgba(255,255,255,0.25)' : 'var(--ink)', color: panelOpen ? '#fff' : 'var(--on-ink)',
              borderRadius: '7px', padding: '1px 4px', lineHeight: 1.4 }}>
              {bookmarks.length}
            </span>
          )}
        </button>

        <button
          onClick={onTogglePreRead}
          title={preReadMode ? '关闭预读模式' : '预读模式：划词即收藏，无弹窗'}
          className="flex items-center justify-center rounded-lg transition-all"
          style={{
            width: 30, height: 30,
            background: preReadMode ? 'rgba(196,154,60,0.18)' : 'transparent',
            border: `1px solid ${preReadMode ? 'rgba(196,154,60,0.45)' : 'var(--surface-border)'}`,
            cursor: 'pointer',
            color: preReadMode ? 'var(--gold)' : 'var(--ink-muted)',
          }}
          onMouseEnter={(e) => {
            if (!preReadMode) {
              e.currentTarget.style.background = 'var(--hover-bg)'
              e.currentTarget.style.color = 'var(--ink)'
            }
          }}
          onMouseLeave={(e) => {
            if (!preReadMode) {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--ink-muted)'
            }
          }}
        >
          <ScanEye size={13} />
        </button>

        <button onClick={toggleTheme}
          title={theme === 'parchment' ? '切换到夜间模式' : '切换到日间模式'}
          className="flex items-center justify-center rounded-lg transition-all"
          style={{ width: 30, height: 30, background: 'transparent', border: '1px solid var(--surface-border)', cursor: 'pointer', color: 'var(--ink-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; e.currentTarget.style.color = 'var(--ink)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}
        >
          {theme === 'parchment' ? <Moon size={12} /> : <Sun size={12} />}
        </button>

        <div ref={fontSizeRef} style={{ position: 'relative' }}>
          {fontSizeOpen ? (
            <div className="flex items-center gap-0.5 rounded-lg px-1.5"
              style={{ height: 30, border: '1px solid var(--surface-border)', background: 'var(--surface-bg)' }}>
              <Type size={11} style={{ color: 'var(--ink-muted)', marginRight: 3 }} />
              <button onClick={(e) => { e.stopPropagation(); setFontSize(s => Math.max(14, s - 1)) }}
                className="flex items-center justify-center rounded-md transition-all"
                style={{ width: 24, height: 24, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-bg)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <Minus size={11} />
              </button>
              <span style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink)', minWidth: '24px', textAlign: 'center', fontWeight: 500 }}>
                {fontSize}
              </span>
              <button onClick={(e) => { e.stopPropagation(); setFontSize(s => Math.min(28, s + 1)) }}
                className="flex items-center justify-center rounded-md transition-all"
                style={{ width: 24, height: 24, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-bg)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <Plus size={11} />
              </button>
            </div>
          ) : (
            <button onClick={() => setFontSizeOpen(true)}
              className="flex items-center justify-center rounded-lg transition-all"
              style={{ width: 30, height: 30, background: 'transparent', border: '1px solid var(--surface-border)', cursor: 'pointer', color: 'var(--ink-muted)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; e.currentTarget.style.color = 'var(--ink)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}>
              <Type size={12} />
            </button>
          )}
        </div>
      </div>
    </header>
  )
})

export default ReaderHeader
