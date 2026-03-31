import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { ArrowLeft, BookOpen, Type, Minus, Plus, Bookmark, Settings } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAIWordTranslation } from '../hooks/useAIWordTranslation'
import TranslationPopup from './TranslationPopup'
import ParagraphRenderer from './ParagraphRenderer'
import BookmarkHoverCard from './BookmarkHoverCard'
import BookmarkPanel from './BookmarkPanel'
import AISettingsPanel from './AISettingsPanel'
import { detectSelectionType, findContainingSentence, getCharOffset } from '../utils/textUtils'
import { bookmarkStore, createBookmark } from '../store/storage'
import { extractRawText } from '../utils/markdownUtils'

function parseText(text) {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

function MarkdownContent({ markdown, bookmarks, fontSize, onHoverBookmark }) {
  const paraIdxRef = useRef(0)
  paraIdxRef.current = 0
  const bookmarksRef = useRef(bookmarks)
  bookmarksRef.current = bookmarks
  const fontSizeRef = useRef(fontSize)
  fontSizeRef.current = fontSize
  const onHoverRef = useRef(onHoverBookmark)
  onHoverRef.current = onHoverBookmark

  const components = useMemo(() => ({
    p({ children }) {
      const idx = paraIdxRef.current++
      const rawText = extractRawText(children)
      const paraBMs = bookmarksRef.current.filter((b) => b.paragraphIndex === idx)
      const style = { fontFamily: '"Lora", Georgia, serif', fontSize: `${fontSizeRef.current}px`, lineHeight: 1.9, color: 'var(--ink-light)', marginBottom: '1.8em', letterSpacing: '0.01em' }
      return (
        <p data-para-index={idx} style={style}>
          <ParagraphRenderer text={rawText} bookmarks={paraBMs} onHoverBookmark={onHoverRef.current} />
        </p>
      )
    },
    h1: ({ children }) => <h1 className="article-h1">{children}</h1>,
    h2: ({ children }) => <h2 className="article-h2">{children}</h2>,
    h3: ({ children }) => <h3 className="article-h3">{children}</h3>,
    h4: ({ children }) => <h4 className="article-h4">{children}</h4>,
    ul: ({ children }) => <ul className="article-ul">{children}</ul>,
    ol: ({ children }) => <ol className="article-ol">{children}</ol>,
    li: ({ children }) => <li className="article-li">{children}</li>,
    blockquote: ({ children }) => <blockquote className="article-quote">{children}</blockquote>,
    code({ inline, children }) {
      return inline
        ? <code className="article-inline-code">{children}</code>
        : <pre className="article-code-block"><code>{children}</code></pre>
    },
  }), [])

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {markdown}
    </ReactMarkdown>
  )
}

export default function ReaderPage({ article, onBack }) {
  const { text, title, id: articleId } = article
  const paragraphs = parseText(text)

  const [popup, setPopup] = useState(null)
  const [fontSize, setFontSize] = useState(18)
  const [bookmarks, setBookmarks] = useState(() => bookmarkStore.getByArticle(articleId))
  const [hoverBookmark, setHoverBookmark] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const contentRef = useRef(null)
  const hideTimerRef = useRef(null)

  const showHoverCard = useCallback((bm, el) => {
    clearTimeout(hideTimerRef.current)
    if (bm) setHoverBookmark({ bookmark: bm, el })
    else hideTimerRef.current = setTimeout(() => setHoverBookmark(null), 150)
  }, [])

  const { result, loading, error, translate, clear } = useAIWordTranslation()
  const { result: ctxResult, loading: ctxLoading, error: ctxError, translate: translateCtx, clear: clearCtx } = useAIWordTranslation()
  const { result: aiResult, loading: aiLoading, error: aiError, translate: aiTranslate, clear: aiClear } = useAIWordTranslation()

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return

    const selected = selection.toString().trim()
    if (!selected || selected.length < 1) return

    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const selType = detectSelectionType(selected)
    const isShort = selType === 'word' || selType === 'phrase'

    // 找到选中文本所在的段落
    let paraIndex = 0
    let anchorEl = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer
    while (anchorEl && anchorEl.dataset?.paraIndex === undefined) {
      anchorEl = anchorEl.parentElement
    }
    if (anchorEl?.dataset?.paraIndex !== undefined) {
      paraIndex = parseInt(anchorEl.dataset.paraIndex)
    }

    const paraText = (anchorEl?.textContent) || (paragraphs[paraIndex] ?? '')
    const contextSentence = isShort ? findContainingSentence(paraText, selected) : null
    const charOffset = getCharOffset(paraText, selected)

    const popupWidth = isShort ? 150 : 200
    const x = rect.left + rect.width / 2 - popupWidth
    const y = rect.bottom + 12

    setPopup({
      text: selected,
      selectionType: selType,
      position: { x: Math.max(8, x), y, selectionTop: rect.top },
      contextSentence,
      paragraphIndex: paraIndex,
      charOffset,
    })

    clear()
    clearCtx()
    aiClear()
    if (isShort) {
      if (contextSentence && contextSentence !== selected) {
        translateCtx(contextSentence, 'sentence')
        aiTranslate(selected, selType, contextSentence)
      }
    } else {
      translate(selected, selType)
    }
  }, [translate, clear, translateCtx, clearCtx, aiTranslate, aiClear, paragraphs])

  const handleBookmark = useCallback(() => {
    if (!popup) return
    const isShortType = popup.selectionType === 'word' || popup.selectionType === 'phrase'
    const bm = createBookmark({
      type: popup.selectionType,
      text: popup.text,
      translation: isShortType ? (aiResult ?? '') : (result ?? ''),
      contextSentence: popup.contextSentence ?? null,
      contextTranslation: isShortType ? (ctxResult ?? null) : null,
      // result/ctxResult now both from AI
      articleId,
      paragraphIndex: popup.paragraphIndex,
      charOffset: popup.charOffset,
    })
    bookmarkStore.save(bm)
    setBookmarks(bookmarkStore.getByArticle(articleId))
  }, [popup, result, ctxResult, aiResult, articleId])


  const handleDeleteBookmark = useCallback((id) => {
    bookmarkStore.delete(id)
    setBookmarks(bookmarkStore.getByArticle(articleId))
    setHoverBookmark(null)
  }, [articleId])

  const handleJump = useCallback((paraIndex) => {
    const el = document.querySelector(`[data-para-index="${paraIndex}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [])

  const isPopupBookmarked = popup
    ? bookmarks.some(
        (b) => b.text === popup.text && b.paragraphIndex === popup.paragraphIndex
      )
    : false

  const closePopup = useCallback(() => {
    setPopup(null)
    clear()
    clearCtx()
    aiClear()
    window.getSelection()?.removeAllRanges()
  }, [clear, clearCtx, aiClear])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popup && contentRef.current && !e.target.closest('[data-popup]')) {
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed) {
          closePopup()
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [popup, closePopup])

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') closePopup()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [closePopup])

  const wordCount = text.split(/\s+/).filter(Boolean).length
  const readTime = Math.ceil(wordCount / 200)

  return (
    <div
      className="min-h-screen transition-all"
      style={{
        backgroundColor: 'var(--parchment)',
        paddingRight: panelOpen ? '300px' : '0',
        transition: 'padding-right 0.28s cubic-bezier(0.16,1,0.3,1)',
      }}
    >
      {/* Top bar */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-6 py-4"
        style={{
          background: 'rgba(250,244,232,0.85)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(28,25,23,0.07)',
        }}
      >
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-xl px-3 py-2 transition-all"
          style={{
            fontSize: '13px',
            fontFamily: 'DM Sans',
            color: 'var(--ink-muted)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(28,25,23,0.06)'
            e.currentTarget.style.color = 'var(--ink)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--ink-muted)'
          }}
        >
          <ArrowLeft size={15} />
          返回
        </button>

        <div className="flex items-center gap-2">
          <BookOpen size={14} style={{ color: 'var(--gold)' }} />
          <span
            style={{
              fontSize: '13px',
              fontFamily: 'DM Sans',
              color: 'var(--ink-muted)',
            }}
          >
            {wordCount.toLocaleString()} 词 · 约 {readTime} 分钟
          </span>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2">

        {/* Bookmark panel toggle */}
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="relative flex items-center gap-1.5 rounded-xl px-3 py-2 transition-all"
          style={{
            background: panelOpen ? 'var(--ink)' : 'rgba(255,255,255,0.6)',
            border: `1px solid ${panelOpen ? 'var(--ink)' : 'rgba(28,25,23,0.1)'}`,
            cursor: 'pointer',
            color: panelOpen ? '#fff' : 'var(--ink-muted)',
            fontSize: '13px',
            fontFamily: 'DM Sans',
          }}
          onMouseEnter={(e) => {
            if (!panelOpen) {
              e.currentTarget.style.borderColor = 'rgba(196,154,60,0.5)'
              e.currentTarget.style.color = 'var(--ink)'
            }
          }}
          onMouseLeave={(e) => {
            if (!panelOpen) {
              e.currentTarget.style.borderColor = 'rgba(28,25,23,0.1)'
              e.currentTarget.style.color = 'var(--ink-muted)'
            }
          }}
        >
          <Bookmark size={13} />
          <span>收藏</span>
          {bookmarks.length > 0 && (
            <span
              style={{
                fontSize: '10px',
                fontWeight: 600,
                background: panelOpen ? 'rgba(255,255,255,0.25)' : 'var(--ink)',
                color: '#fff',
                borderRadius: '8px',
                padding: '1px 5px',
                lineHeight: 1.4,
              }}
            >
              {bookmarks.length}
            </span>
          )}
        </button>

        {/* AI Settings button */}
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center justify-center rounded-xl transition-all"
          style={{
            width: 34,
            height: 34,
            background: 'rgba(255,255,255,0.6)',
            border: '1px solid rgba(28,25,23,0.1)',
            cursor: 'pointer',
            color: 'var(--ink-muted)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(28,25,23,0.06)'
            e.currentTarget.style.color = 'var(--ink)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.6)'
            e.currentTarget.style.color = 'var(--ink-muted)'
          }}
        >
          <Settings size={14} />
        </button>

        {/* Font size control */}
        <div
          className="flex items-center gap-1 rounded-xl px-2 py-1.5"
          style={{ border: '1px solid rgba(28,25,23,0.1)', background: 'rgba(255,255,255,0.6)' }}
        >
          <Type size={12} style={{ color: 'var(--ink-muted)', marginRight: 4 }} />
          <button
            onClick={() => setFontSize((s) => Math.max(14, s - 1))}
            className="flex items-center justify-center rounded-lg transition-all"
            style={{ width: 26, height: 26, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(28,25,23,0.06)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Minus size={12} />
          </button>
          <span
            style={{
              fontSize: '12px',
              fontFamily: 'DM Sans',
              color: 'var(--ink)',
              minWidth: '28px',
              textAlign: 'center',
              fontWeight: 500,
            }}
          >
            {fontSize}
          </span>
          <button
            onClick={() => setFontSize((s) => Math.min(28, s + 1))}
            className="flex items-center justify-center rounded-lg transition-all"
            style={{ width: 26, height: 26, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(28,25,23,0.06)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Plus size={12} />
          </button>
        </div>
        </div>
      </header>

      {/* Article */}
      <main className="px-6 pb-24 pt-12">
        <div style={{ maxWidth: '680px', margin: '0 auto' }}>
          {/* Title */}
          <div className="mb-12 animate-fade-up">
            <h1
              style={{
                fontFamily: '"Playfair Display", Georgia, serif',
                fontSize: 'clamp(26px, 4vw, 38px)',
                fontWeight: 700,
                color: 'var(--ink)',
                lineHeight: 1.25,
                letterSpacing: '-0.02em',
                marginBottom: '16px',
              }}
            >
              {title}
            </h1>
            <div
              style={{
                height: '2px',
                width: '48px',
                background: 'var(--gold)',
                borderRadius: '2px',
              }}
            />
          </div>

          {/* Hint */}
          <div
            className="flex items-center gap-2 rounded-xl px-4 py-3 mb-10 animate-fade-up"
            style={{
              background: 'rgba(196,154,60,0.08)',
              border: '1px solid rgba(196,154,60,0.18)',
            }}
          >
            <span style={{ fontSize: '14px' }}>💡</span>
            <p
              style={{
                fontSize: '13px',
                fontFamily: 'DM Sans',
                color: 'var(--gold-dark)',
                lineHeight: 1.5,
              }}
            >
              划选<strong>单词</strong>获得词义，划选<strong>句子或段落</strong>获得整句翻译。按 Esc 关闭翻译。
            </p>
          </div>

          {/* Content */}
          <div
            ref={contentRef}
            className="reader-content animate-fade-up"
            onMouseUp={handleMouseUp}
            style={{ cursor: 'text' }}
          >
            {article.markdown ? (
              <MarkdownContent
                markdown={article.markdown}
                bookmarks={bookmarks}
                fontSize={fontSize}
                onHoverBookmark={showHoverCard}
              />
            ) : (
              paragraphs.map((para, i) => {
                const paraBMs = bookmarks.filter((b) => b.paragraphIndex === i)
                return (
                  <p
                    key={i}
                    data-para-index={i}
                    style={{
                      fontFamily: '"Lora", Georgia, serif',
                      fontSize: `${fontSize}px`,
                      lineHeight: 1.9,
                      color: 'var(--ink-light)',
                      marginBottom: '1.8em',
                      letterSpacing: '0.01em',
                    }}
                  >
                    <ParagraphRenderer
                      text={para}
                      bookmarks={paraBMs}
                      onHoverBookmark={showHoverCard}
                    />
                  </p>
                )
              })
            )}
          </div>

          {/* End mark */}
          <div className="flex items-center justify-center gap-4 mt-16 mb-4">
            <div style={{ flex: 1, height: '1px', background: 'rgba(28,25,23,0.1)' }} />
            <span style={{ fontSize: '18px', opacity: 0.4 }}>✦</span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(28,25,23,0.1)' }} />
          </div>
          <p
            className="text-center"
            style={{
              fontSize: '13px',
              fontFamily: 'DM Sans',
              color: 'var(--ink-muted)',
              opacity: 0.6,
              marginTop: '8px',
            }}
          >
            — 全文完 —
          </p>
        </div>
      </main>

      {/* Translation popup */}
      {popup && (
        <div data-popup="true">
          <TranslationPopup
            selectedText={popup.text}
            selectionType={popup.selectionType}
            position={popup.position}
            loading={loading}
            result={result}
            error={error}
            contextSentence={popup.contextSentence}
            ctxLoading={ctxLoading}
            ctxResult={ctxResult}
            aiResult={aiResult}
            aiLoading={aiLoading}
            aiError={aiError}
            onClose={closePopup}
            onBookmark={handleBookmark}
            isBookmarked={isPopupBookmarked}
          />
        </div>
      )}

      {/* Bookmark hover card */}
      {hoverBookmark && !popup && (
        <div
          data-popup="true"
          onMouseEnter={() => clearTimeout(hideTimerRef.current)}
          onMouseLeave={() => { hideTimerRef.current = setTimeout(() => setHoverBookmark(null), 150) }}
        >
          <BookmarkHoverCard
            bookmark={hoverBookmark.bookmark}
            anchorEl={hoverBookmark.el}
            onDelete={handleDeleteBookmark}
          />
        </div>
      )}

      {/* AI Settings */}
      <AISettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Bookmark panel */}
      <BookmarkPanel
        open={panelOpen}
        bookmarks={bookmarks}
        onClose={() => setPanelOpen(false)}
        onDelete={handleDeleteBookmark}
        onJump={(paraIndex) => {
          handleJump(paraIndex)
          setPanelOpen(false)
        }}
      />
    </div>
  )
}
