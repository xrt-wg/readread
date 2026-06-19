import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { ArrowLeft, BookOpen, Type, Minus, Plus, Bookmark, Star, Sun, Moon, Text } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAuth } from '../hooks/useAuth'
import { useDirectTranslation } from '../hooks/useDirectTranslation'
import { useBookmarkAI } from '../hooks/useBookmarkAI'
import { useTheme } from '../hooks/useTheme.jsx'
import TranslationPopup from './TranslationPopup'
import ParagraphRenderer from './ParagraphRenderer'
import BookmarkHoverCard from './BookmarkHoverCard'
import BookmarkPanel from './BookmarkPanel'
import SectionTocPanel from './SectionTocPanel'
import {
  clearReadingMark,
  deleteBookmark,
  getReadingMark,
  listBookmarksByArticle,
  saveBookmark,
  saveReadingMark,
  setReadingMarkCompleted,
} from '../services/library'
import { isLibraryAccessError, resolveLibraryErrorMessage } from '../services/errorUtils'
import { rateRecommendation, getMyRating } from '../services/supabase'
import { getSupabaseClient } from '../services/supabase/client'
import { detectSelectionType, findContainingSentence, getCharOffset } from '../utils/textUtils'
import { createBookmark } from '../store/storage'
import { extractRawText } from '../utils/markdownUtils'

function parseText(text) {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

function checkHasImage(children) {
  if (!children) return false
  if (Array.isArray(children)) return children.some(checkHasImage)
  if (typeof children === 'object' && children !== null) {
    if (children.type === 'img') return true
    if (typeof children.type === 'function' && 'src' in (children.props ?? {})) return true
    if (children.props?.children) return checkHasImage(children.props.children)
  }
  return false
}

function MarkdownContent({ markdown, bookmarks, fontSize, onHoverBookmark, readingMark, onSetReadingMark }) {
  const paraIdxRef = useRef(0)
  paraIdxRef.current = 0
  const bookmarksRef = useRef(bookmarks)
  bookmarksRef.current = bookmarks
  const fontSizeRef = useRef(fontSize)
  fontSizeRef.current = fontSize
  const onHoverRef = useRef(onHoverBookmark)
  onHoverRef.current = onHoverBookmark
  const onSetReadingMarkRef = useRef(onSetReadingMark)
  onSetReadingMarkRef.current = onSetReadingMark

  const components = useMemo(() => ({
    p({ children }) {
      const idx = paraIdxRef.current++
      const style = { fontFamily: '"Lora", Georgia, serif', fontSize: `${fontSizeRef.current}px`, lineHeight: 1.9, color: 'var(--ink-light)', marginBottom: '1.8em', letterSpacing: '0.01em' }
      if (checkHasImage(children)) {
        return <p data-para-index={idx} style={style}>{children}</p>
      }
      const rawText = extractRawText(children)
      const paraBMs = bookmarksRef.current.filter((b) => b.paragraphIndex === idx)
      const isMarked = readingMark?.paragraphIndex === idx && !readingMark?.completed
      return (
        <div className="group relative">
          <button
            onClick={() => onSetReadingMarkRef.current(idx)}
            title={isMarked ? '取消阅读标记' : '标记读到这里'}
            className={isMarked ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity duration-150'}
            style={{
              position: 'absolute',
              left: '-32px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '6px',
              color: isMarked ? 'var(--gold)' : 'rgba(28,25,23,0.3)',
            }}
          >
            <Bookmark size={14} fill={isMarked ? 'currentColor' : 'none'} />
          </button>
          <p data-para-index={idx} style={style}>
            <ParagraphRenderer text={rawText} bookmarks={paraBMs} onHoverBookmark={onHoverRef.current} />
          </p>
        </div>
      )
    },
    h1: ({ children }) => <h1 className="article-h1">{children}</h1>,
    h2: ({ children }) => <h2 className="article-h2">{children}</h2>,
    h3: ({ children }) => <h3 className="article-h3">{children}</h3>,
    h4: ({ children }) => <h4 className="article-h4">{children}</h4>,
    ul: ({ children }) => <ul className="article-ul">{children}</ul>,
    ol: ({ children }) => <ol className="article-ol">{children}</ol>,
    li({ children }) {
      const idx = paraIdxRef.current++
      const rawText = extractRawText(children)
      const paraBMs = bookmarksRef.current.filter((b) => b.paragraphIndex === idx)
      return (
        <li data-para-index={idx} className="article-li">
          <ParagraphRenderer text={rawText} bookmarks={paraBMs} onHoverBookmark={onHoverRef.current} />
        </li>
      )
    },
    blockquote: ({ children }) => <blockquote className="article-quote">{children}</blockquote>,
    code({ inline, children }) {
      return inline
        ? <code className="article-inline-code">{children}</code>
        : <pre className="article-code-block"><code>{children}</code></pre>
    },
    img({ src, alt }) {
      return (
        <img
          src={src}
          alt={alt ?? ''}
          onError={(e) => { e.currentTarget.style.display = 'none' }}
          style={{
            maxWidth: '100%',
            height: 'auto',
            borderRadius: '8px',
            margin: '1em 0',
            display: 'block',
          }}
        />
      )
    },
  }), [readingMark])

  const fmMatch = markdown?.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const frontmatterFields = fmMatch
    ? fmMatch[1].split(/\r?\n/).filter(Boolean).map((line) => {
        const colon = line.indexOf(':')
        return colon === -1
          ? { key: null, val: line }
          : { key: line.slice(0, colon).trim(), val: line.slice(colon + 1).trim() }
      })
    : null
  const body = fmMatch ? markdown.slice(fmMatch[0].length) : markdown
  const fmText = frontmatterFields
    ? frontmatterFields.map(({ key, val }) => (key ? `${key} · ${val}` : val)).join('\n')
    : ''

  return (
    <>
      {frontmatterFields && (
        <div
          data-para-index="-1"
          className="article-quote"
          style={{
            marginBottom: '1.8em',
            fontFamily: '"Lora", Georgia, serif',
            fontSize: `${fontSizeRef.current}px`,
            lineHeight: 1.9,
            whiteSpace: 'pre-line',
          }}
        >
          <ParagraphRenderer
            text={fmText}
            bookmarks={bookmarksRef.current.filter((b) => b.paragraphIndex === -1)}
            onHoverBookmark={onHoverRef.current}
          />
        </div>
      )}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {body}
      </ReactMarkdown>
    </>
  )
}

export default function ReaderPage({ article, onBack }) {
  const { text, title, id: articleId, sections, sectionCount } = article
  const hasMultipleSections = sectionCount > 1 && Array.isArray(sections) && sections.length > 1
  const paragraphs = parseText(text)
  const { canUseCloudLibrary, refreshAuthState, userId } = useAuth()

  const [popup, setPopup] = useState(null)
  const [fontSize, setFontSize] = useState(18)
  const [fontSizeOpen, setFontSizeOpen] = useState(false)
  const fontSizeRef = useRef(null)
  const [bookmarks, setBookmarks] = useState([])
  const [hoverBookmark, setHoverBookmark] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [readingMark, setReadingMark] = useState(null)
  const [recSubmissionId, setRecSubmissionId] = useState(null)  // 若文章来自推荐区，存储 submission id
  const [recRating, setRecRating] = useState(null)               // 当前用户对该推荐的评分
  const [recRatingLoading, setRecRatingLoading] = useState(false)
  const [libraryError, setLibraryError] = useState('')
  const [showHint, setShowHint] = useState(() => !localStorage.getItem('readread_hint_dismissed'))
  const [currentSectionIdx, setCurrentSectionIdx] = useState(0)
  const [tocOpen, setTocOpen] = useState(false)
  const contentRef = useRef(null)
  const hideTimerRef = useRef(null)

  // 当前 section（多 section 文档取 sections[currentSectionIdx]，单 section 退化为全文）
  const currentSection = hasMultipleSections ? sections[currentSectionIdx] : null
  const currentBody = currentSection
    ? currentSection.body
    : { text, markdown: article.markdown, wordCount: article.wordCount }

  const showHoverCard = useCallback((bm, el) => {
    clearTimeout(hideTimerRef.current)
    if (bm) setHoverBookmark({ bookmark: bm, el })
    else hideTimerRef.current = setTimeout(() => setHoverBookmark(null), 150)
  }, [])

  const { result, loading, error, translate, clear } = useDirectTranslation()
  const { translateBookmark } = useBookmarkAI()
  const { theme, toggleTheme } = useTheme()

  const loadReaderState = useCallback(async () => {
    const options = {
      canUseCloudLibrary,
      userId,
    }
    const [nextBookmarks, nextReadingMark] = await Promise.all([
      listBookmarksByArticle(articleId, options),
      getReadingMark(articleId, options),
    ])

    setBookmarks(nextBookmarks)
    setReadingMark(nextReadingMark)
  }, [articleId, canUseCloudLibrary, refreshAuthState, userId])

  // 当文章标记为已读完时，检查是否来自推荐区（若有则加载推荐评分信息）
  useEffect(() => {
    if (!readingMark?.completed || !article.sourceImportId) return
    let active = true
    async function check() {
      try {
        const client = getSupabaseClient()
        // 查找该文章的来源 import_item
        const { data: item } = await client
          .from('import_items')
          .select('id, origin, share_source_id')
          .eq('id', article.sourceImportId)
          .is('deleted_at', null)
          .maybeSingle()
        if (!active) return
        if (item && (item.origin === 'featured' || item.origin === 'featured_legacy') && item.share_source_id) {
          setRecSubmissionId(item.share_source_id)
          // 获取当前用户评分
          if (userId) {
            const rating = await getMyRating(item.share_source_id, userId)
            if (active) setRecRating(rating?.rating || null)
          }
        }
      } catch (_) { /* 非致命 */ }
    }
    check()
    return () => { active = false }
  }, [readingMark?.completed, article.sourceImportId, userId])

  const handleRecRate = useCallback(async (rating) => {
    if (!recSubmissionId || !userId) return
    setRecRatingLoading(true)
    try {
      await rateRecommendation(recSubmissionId, rating, userId)
      setRecRating(rating)
    } catch (e) {
      // 非致命错误，静默处理
    } finally {
      setRecRatingLoading(false)
    }
  }, [recSubmissionId, userId])

  const handleMouseUp = useCallback((event) => {
    const targetEl = event?.target instanceof Element ? event.target : event?.target?.parentElement
    if (targetEl?.closest?.('[data-popup="true"]')) return

    const contentEl = contentRef.current
    if (!contentEl) return

    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    if (!selection.rangeCount) return

    const range = selection.getRangeAt(0)
    const commonNode = range.commonAncestorContainer
    const commonEl = commonNode.nodeType === Node.TEXT_NODE ? commonNode.parentElement : commonNode
    if (!commonEl || !contentEl.contains(commonEl)) return

    const selected = selection.toString().trim()
    if (!selected || selected.length < 1) return

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
    translate(selected)
    if (showHint) {
      setShowHint(false)
      localStorage.setItem('readread_hint_dismissed', '1')
    }
  }, [translate, clear, paragraphs, showHint])

  const handleBookmark = useCallback(async () => {
    if (!popup) return
    try {
      setLibraryError('')

      const bm = createBookmark({
        type: popup.selectionType,
        text: popup.text,
        contextSentence: popup.contextSentence ?? null,
        articleId,
        paragraphIndex: popup.paragraphIndex,
        charOffset: popup.charOffset,
        sectionId: currentSection?.id ?? null,
        sectionHeading: currentSection?.heading ?? null,
      })
      const options = {
        canUseCloudLibrary,
        userId,
      }

      const savedBookmark = await saveBookmark(bm, options)
      await loadReaderState()
      translateBookmark(savedBookmark, async () => {
        await loadReaderState()
      })
    } catch (bookmarkError) {
      if (isLibraryAccessError(bookmarkError)) {
        refreshAuthState()
      }

      setLibraryError(resolveLibraryErrorMessage(bookmarkError, '保存收藏失败，请稍后重试'))
    }
  }, [popup, articleId, canUseCloudLibrary, loadReaderState, refreshAuthState, translateBookmark, userId])


  const handleDeleteBookmark = useCallback(async (id) => {
    try {
      setLibraryError('')

      const options = {
        canUseCloudLibrary,
        userId,
      }

      await deleteBookmark(id, options)
      await loadReaderState()
      setHoverBookmark(null)
    } catch (deleteError) {
      if (isLibraryAccessError(deleteError)) {
        refreshAuthState()
      }

      setLibraryError(resolveLibraryErrorMessage(deleteError, '删除收藏失败，请稍后重试'))
    }
  }, [articleId, canUseCloudLibrary, loadReaderState, refreshAuthState, userId])

  // P0-3: 跳转章节内段落 — 多 section 先切换
  const handleJump = useCallback((paraIndex, sectionId) => {
    if (hasMultipleSections && sectionId) {
      const idx = sections.findIndex(s => s.id === sectionId)
      if (idx >= 0 && idx !== currentSectionIdx) {
        setCurrentSectionIdx(idx)
        // 切换 section 后延迟滚动（等待 DOM 重挂载）
        setTimeout(() => {
          const el = document.querySelector(`[data-para-index="${paraIndex}"]`)
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 200)
        return
      }
    }
    const el = document.querySelector(`[data-para-index="${paraIndex}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [hasMultipleSections, sections, currentSectionIdx])

  // P1-2: section 切换时滚动到顶部
  useEffect(() => {
    if (hasMultipleSections) {
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }, [currentSectionIdx, hasMultipleSections])

  const handleSetReadingMark = useCallback(async (paraIndex) => {
    try {
      setLibraryError('')

      const options = {
        canUseCloudLibrary,
        userId,
      }

      if (readingMark?.paragraphIndex === paraIndex && !readingMark?.completed) {
        const clearedMark = await clearReadingMark(articleId, options)
        setReadingMark(clearedMark)
      } else {
        const mark = await saveReadingMark(articleId, paraIndex, options, currentSection?.id ?? null)
        setReadingMark(mark)
      }
    } catch (readingMarkError) {
      if (isLibraryAccessError(readingMarkError)) {
        refreshAuthState()
      }

      setLibraryError(resolveLibraryErrorMessage(readingMarkError, '更新阅读进度失败，请稍后重试'))
    }
  }, [articleId, canUseCloudLibrary, readingMark, refreshAuthState, userId])

  // 跳转后待 DOM 就绪再滚动（useEffect 监听 currentSectionIdx 变化）
  const pendingScrollRef = useRef(null)

  useEffect(() => {
    if (pendingScrollRef.current && currentSectionIdx === pendingScrollRef.current.targetIdx) {
      const timer = setTimeout(() => {
        const el = document.querySelector(`[data-para-index="${pendingScrollRef.current.paraIndex}"]`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        pendingScrollRef.current = null
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [currentSectionIdx])

  const handleJumpToReadingMark = useCallback(() => {
    if (!readingMark || readingMark.completed) return
    if (hasMultipleSections && readingMark.sectionId) {
      const idx = sections.findIndex(s => s.id === readingMark.sectionId)
      if (idx >= 0 && idx !== currentSectionIdx) {
        pendingScrollRef.current = { targetIdx: idx, paraIndex: readingMark.paragraphIndex }
        setCurrentSectionIdx(idx)
        return
      }
    }
    const el = document.querySelector(`[data-para-index="${readingMark.paragraphIndex}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [readingMark, hasMultipleSections, sections, currentSectionIdx])

  const handleMarkCompleted = useCallback(async () => {
    try {
      setLibraryError('')

      const mark = await setReadingMarkCompleted(articleId, {
        canUseCloudLibrary,
        userId,
      })
      setReadingMark(mark)
    } catch (markCompletedError) {
      if (isLibraryAccessError(markCompletedError)) {
        refreshAuthState()
      }

      setLibraryError(resolveLibraryErrorMessage(markCompletedError, '更新阅读完成状态失败，请稍后重试'))
    }
  }, [articleId, canUseCloudLibrary, refreshAuthState, userId])

  const isPopupBookmarked = popup
    ? bookmarks.some(
        (b) => b.text === popup.text && b.paragraphIndex === popup.paragraphIndex
      )
    : false

  const closePopup = useCallback(() => {
    setPopup(null)
    clear()
    window.getSelection()?.removeAllRanges()
  }, [clear])

  useEffect(() => {
    let isActive = true

    async function initializeReaderState() {
      try {
        const options = {
          canUseCloudLibrary,
          userId,
        }
        const [nextBookmarks, nextReadingMark] = await Promise.all([
          listBookmarksByArticle(articleId, options),
          getReadingMark(articleId, options),
        ])

        if (!isActive) {
          return
        }

        setBookmarks(nextBookmarks)
        setReadingMark(nextReadingMark)
      } catch (loadError) {
        if (!isActive) {
          return
        }

        if (isLibraryAccessError(loadError)) {
          refreshAuthState()
        }

        setBookmarks([])
        setReadingMark(null)
        setLibraryError(resolveLibraryErrorMessage(loadError, '加载阅读状态失败，请稍后重试'))
      }
    }

    initializeReaderState()

    return () => {
      isActive = false
    }
  }, [articleId, canUseCloudLibrary, refreshAuthState, userId])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popup && !e.target.closest('[data-popup]')) {
        closePopup()
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

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseUp])

  const wordCount = text.split(/\s+/).filter(Boolean).length

  const progressBarRef = useRef(null)
  const scrollPercentTextRef = useRef(null)
  const [headerVisible, setHeaderVisible] = useState(true)
  const lastScrollYRef = useRef(0)
  const tickingRef = useRef(false)

  useEffect(() => {
    const handleScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight
      const pct = scrollable > 0 ? Math.round((window.scrollY / scrollable) * 100) : 0
      if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`
      if (scrollPercentTextRef.current) scrollPercentTextRef.current.textContent = `${pct}%`

      // Header hide/show on scroll
      if (!tickingRef.current) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY
          const scrollingDown = currentScrollY > lastScrollYRef.current
          const diff = currentScrollY - lastScrollYRef.current

          if (currentScrollY < 20) {
            setHeaderVisible(true)
          } else if (scrollingDown && currentScrollY > 80 && diff > 5) {
            setHeaderVisible(false)
          } else if (!scrollingDown && diff < -5) {
            setHeaderVisible(true)
          }

          lastScrollYRef.current = currentScrollY
          tickingRef.current = false
        })
        tickingRef.current = true
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (!fontSizeOpen) return
    const handleClick = (e) => {
      if (fontSizeRef.current && !fontSizeRef.current.contains(e.target)) {
        setFontSizeOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [fontSizeOpen])

  useEffect(() => {
    if (readingMark && !readingMark.completed) {
      const timer = setTimeout(() => {
        const el = document.querySelector(`[data-para-index="${readingMark.paragraphIndex}"]`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [readingMark])

  return (
    <div
      className="min-h-screen transition-all"
      style={{
        backgroundColor: 'var(--parchment)',
        paddingRight: panelOpen ? '300px' : '0',
        transition: 'padding-right 0.28s cubic-bezier(0.16,1,0.3,1)',
      }}
    >
      {/* Reading progress bar — always visible */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, height: '2px', pointerEvents: 'none' }}>
        <div
          ref={progressBarRef}
          style={{ height: '100%', width: '0%', background: 'rgba(196,154,60,0.4)' }}
        />
      </div>

      {/* Top bar — hides on scroll down, shows on scroll up */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-5 py-2.5"
        style={{
          background: 'var(--header-bg)',
          backdropFilter: 'blur(12px)',
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
            fontSize: '12px',
            fontFamily: 'DM Sans',
            color: 'var(--ink-muted)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--hover-bg)'
            e.currentTarget.style.color = 'var(--ink)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--ink-muted)'
          }}
        >
          <ArrowLeft size={13} />
        </button>

        <div className="flex items-center gap-1.5">
          <BookOpen size={12} style={{ color: 'var(--gold)' }} />
          <span
            ref={scrollPercentTextRef}
            style={{
              fontSize: '12px',
              fontFamily: 'DM Sans',
              color: 'var(--ink-muted)',
            }}
          >
            0%
          </span>
          {hasMultipleSections && (
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
              目录 · {currentSectionIdx + 1}/{sectionCount}
            </button>
          )}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-1.5">

        {/* Reading mark jump */}
        <button
          onClick={handleJumpToReadingMark}
          disabled={!readingMark || readingMark.completed}
          title="跳转到阅读位置"
          className="flex items-center justify-center rounded-lg transition-all"
          style={{
            width: 30,
            height: 30,
            background: 'transparent',
            border: `1px solid ${readingMark && !readingMark.completed ? 'rgba(196,154,60,0.4)' : 'var(--border-subtle)'}`,
            cursor: readingMark && !readingMark.completed ? 'pointer' : 'default',
            color: readingMark && !readingMark.completed ? 'var(--gold)' : 'var(--ink-muted)',
          }}
        >
          <Bookmark size={12} fill={readingMark && !readingMark.completed ? 'currentColor' : 'none'} />
        </button>

        {/* Bookmark panel toggle */}
        <button
          onClick={() => setPanelOpen((v) => !v)}
          title="收藏"
          className="relative flex items-center justify-center rounded-lg transition-all"
          style={{
            width: 30,
            height: 30,
            background: panelOpen ? 'var(--ink)' : 'var(--surface-bg)',
            border: `1px solid ${panelOpen ? 'var(--ink)' : 'var(--surface-border)'}`,
            cursor: 'pointer',
            color: panelOpen ? '#fff' : 'var(--ink-muted)',
          }}
          onMouseEnter={(e) => {
            if (!panelOpen) {
              e.currentTarget.style.borderColor = 'rgba(196,154,60,0.5)'
              e.currentTarget.style.color = 'var(--ink)'
            }
          }}
          onMouseLeave={(e) => {
            if (!panelOpen) {
              e.currentTarget.style.borderColor = 'var(--surface-border)'
              e.currentTarget.style.color = 'var(--ink-muted)'
            }
          }}
        >
          <Star size={12} />
          {bookmarks.length > 0 && (
            <span
              style={{
                position: 'absolute',
                top: -4,
                right: -6,
                fontSize: '9px',
                fontWeight: 600,
                background: panelOpen ? 'rgba(255,255,255,0.25)' : 'var(--ink)',
                color: '#fff',
                borderRadius: '7px',
                padding: '1px 4px',
                lineHeight: 1.4,
              }}
            >
              {bookmarks.length}
            </span>
          )}
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={theme === 'parchment' ? '切换到夜间模式' : '切换到日间模式'}
          className="flex items-center justify-center rounded-lg transition-all"
          style={{
            width: 30,
            height: 30,
            background: 'transparent',
            border: '1px solid var(--surface-border)',
            cursor: 'pointer',
            color: 'var(--ink-muted)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--hover-bg)'
            e.currentTarget.style.color = 'var(--ink)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--ink-muted)'
          }}
        >
          {theme === 'parchment' ? <Moon size={12} /> : <Sun size={12} />}
        </button>

        {/* Font size control */}
        <div ref={fontSizeRef} style={{ position: 'relative' }}>
          {fontSizeOpen ? (
            <div
              className="flex items-center gap-0.5 rounded-lg px-1.5"
              style={{ height: 30, border: '1px solid var(--surface-border)', background: 'var(--surface-bg)' }}
            >
              <Type size={11} style={{ color: 'var(--ink-muted)', marginRight: 3 }} />
              <button
                onClick={(e) => { e.stopPropagation(); setFontSize((s) => Math.max(14, s - 1)) }}
                className="flex items-center justify-center rounded-md transition-all"
                style={{ width: 24, height: 24, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-bg)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Minus size={11} />
              </button>
              <span
                style={{
                  fontSize: '11px',
                  fontFamily: 'DM Sans',
                  color: 'var(--ink)',
                  minWidth: '24px',
                  textAlign: 'center',
                  fontWeight: 500,
                }}
              >
                {fontSize}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setFontSize((s) => Math.min(28, s + 1)) }}
                className="flex items-center justify-center rounded-md transition-all"
                style={{ width: 24, height: 24, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-bg)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Plus size={11} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setFontSizeOpen(true)}
              title="调节字体大小"
              className="flex items-center justify-center rounded-lg transition-all"
              style={{
                width: 30,
                height: 30,
                background: 'transparent',
                border: '1px solid var(--surface-border)',
                cursor: 'pointer',
                color: 'var(--ink-muted)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--hover-bg)'
                e.currentTarget.style.color = 'var(--ink)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--ink-muted)'
              }}
            >
              <Type size={12} />
            </button>
          )}
        </div>
        </div>
      </header>

      {/* Hot zone to reveal header when hidden */}
      {!headerVisible && (
        <div
          onClick={() => setHeaderVisible(true)}
          title="显示工具栏"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: '40px',
            zIndex: 39,
            cursor: 'pointer',
          }}
        />
      )}

      {/* Article */}
      <main className="px-6 pb-24 pt-12">
        <div style={{ maxWidth: '680px', margin: '0 auto' }}>
          {libraryError ? (
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {libraryError}
            </div>
          ) : null}

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
          {showHint && (
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
          )}

          {/* Content */}
          <div
            ref={contentRef}
            className="reader-content animate-fade-up"
            style={{ cursor: 'text' }}
          >
            {currentBody.markdown != null ? (
              <MarkdownContent
                key={currentSection?.id || 's_main'}
                markdown={currentBody.markdown}
                bookmarks={hasMultipleSections ? bookmarks.filter(b => b.sectionId === (currentSection?.id ?? null)) : bookmarks}
                fontSize={fontSize}
                onHoverBookmark={showHoverCard}
                readingMark={readingMark}
                onSetReadingMark={handleSetReadingMark}
              />
            ) : (
              (hasMultipleSections ? parseText(currentBody.text) : paragraphs).map((para, i) => {
                const paraBMs = bookmarks.filter((b) => b.paragraphIndex === i && (hasMultipleSections ? b.sectionId === (currentSection?.id ?? null) : true))
                const isMarked = readingMark?.paragraphIndex === i && !readingMark?.completed
                return (
                  <div key={i} className="group relative">
                    <button
                      onClick={() => handleSetReadingMark(i)}
                      title={isMarked ? '取消阅读标记' : '标记读到这里'}
                      className={isMarked ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity duration-150'}
                      style={{
                        position: 'absolute',
                        left: '-32px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px',
                        borderRadius: '6px',
                        color: isMarked ? 'var(--gold)' : 'rgba(28,25,23,0.3)',
                      }}
                    >
                      <Bookmark size={14} fill={isMarked ? 'currentColor' : 'none'} />
                    </button>
                    <p
                      data-para-index={i}
                      style={{
                        fontFamily: '"Lora", Georgia, serif',
                        fontSize: `${fontSize}px`,
                        lineHeight: 1.9,
                        color: 'var(--ink-light)',
                        marginBottom: '1.6em',
                        letterSpacing: '0.01em',
                      }}
                    >
                      <ParagraphRenderer
                        text={para}
                        bookmarks={paraBMs}
                        onHoverBookmark={showHoverCard}
                      />
                    </p>
                  </div>
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

          {/* Mark as completed */}
          <div className="flex justify-center mt-8 mb-4">
            {readingMark?.completed ? (
              <>
              <div
                className="flex items-center gap-2 rounded-xl px-5 py-2.5"
                style={{
                  background: 'rgba(34,197,94,0.08)',
                  border: '1px solid rgba(34,197,94,0.25)',
                  color: '#16a34a',
                  fontSize: '13px',
                  fontFamily: 'DM Sans',
                  fontWeight: 500,
                }}
              >
                <span>✓</span>
                <span>已读完</span>
              </div>

              {/* 评分：仅当文章来自推荐区时展示 */}
              {recSubmissionId && (
                <div className="flex items-center justify-center gap-2 mt-3">
                  <span style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', marginRight: '4px' }}>评分：</span>
                  {['recommend', 'average', 'not_good'].map(r => {
                    const labels = { recommend: '推荐', average: '一般', not_good: '不行' }
                    const isActive = recRating === r
                    return (
                      <button key={r} onClick={() => handleRecRate(r)} disabled={recRatingLoading}
                        style={{
                          fontSize: '11px', fontFamily: 'DM Sans', fontWeight: isActive ? 600 : 400,
                          border: `1px solid ${isActive ? 'var(--gold-dark)' : 'rgba(28,25,23,0.12)'}`,
                          borderRadius: '6px', padding: '4px 10px', cursor: 'pointer',
                          background: isActive ? 'rgba(196,154,60,0.12)' : 'transparent',
                          color: isActive ? 'var(--gold-dark)' : 'var(--ink-muted)',
                          opacity: recRatingLoading ? 0.5 : 1,
                        }}>
                        {labels[r]}
                      </button>
                    )
                  })}
                </div>
              )}
              </>
            ) : (
              <button
                onClick={handleMarkCompleted}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 transition-all"
                style={{
                  background: 'rgba(255,255,255,0.6)',
                  border: '1px solid rgba(28,25,23,0.12)',
                  color: 'var(--ink-muted)',
                  fontSize: '13px',
                  fontFamily: 'DM Sans',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(34,197,94,0.08)'
                  e.currentTarget.style.borderColor = 'rgba(34,197,94,0.3)'
                  e.currentTarget.style.color = '#16a34a'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.6)'
                  e.currentTarget.style.borderColor = 'rgba(28,25,23,0.12)'
                  e.currentTarget.style.color = 'var(--ink-muted)'
                }}
              >
                <span>标记已读完</span>
              </button>
            )}
          </div>
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

      {/* Section TOC panel (multi-section only) */}
      {hasMultipleSections && (
        <SectionTocPanel
          open={tocOpen}
          sections={sections}
          currentIdx={currentSectionIdx}
          onSelect={setCurrentSectionIdx}
          onClose={() => setTocOpen(false)}
        />
      )}

      {/* Bookmark panel */}
      <BookmarkPanel
        open={panelOpen}
        bookmarks={bookmarks}
        onClose={() => setPanelOpen(false)}
        onDelete={handleDeleteBookmark}
        onJump={(paraIndex, sectionId) => {
          handleJump(paraIndex, sectionId)
          setPanelOpen(false)
        }}
      />
    </div>
  )
}
