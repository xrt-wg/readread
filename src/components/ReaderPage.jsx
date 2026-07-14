import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { ArrowLeft, BookOpen, Type, Minus, Plus, Bookmark, Star, Sun, Moon, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useDirectTranslation } from '../hooks/useDirectTranslation'
import { useBookmarkAI } from '../hooks/useBookmarkAI'
import { useTheme } from '../hooks/useTheme.jsx'
import TranslationPopup from './TranslationPopup'
import ReaderHeader from './ReaderHeader'
import SectionFlow, { parseText } from './SectionFlow'
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
import { returnToShelf } from '../services/readings'
import { isLibraryAccessError, resolveLibraryErrorMessage } from '../services/errorUtils'
import { rateRecommendation, getMyRating } from '../services/supabase/recommendationService'
import { detectSelectionType, findContainingSentence, getCharOffset } from '../utils/textUtils'
import { createBookmark } from '../store/storage'
import { getParagraphs } from '../services/progress'

/**
 * 按 depth===0 把平铺 sections 分组为「章」。
 * 每章 = 一个顶层节 + 其后所有 depth>0 的子节（直到下一个顶层节）。
 * 首个标题前的引言（heading=null, depth=0）自成一章。
 *
 * @returns {{ lead: object, all: object[], wordCount: number, order: number }[]}
 */
function groupIntoChapters(sections) {
  const chapters = []
  for (const section of sections) {
    if (section.depth === 0 || chapters.length === 0) {
      chapters.push({ lead: section, all: [section], wordCount: section.body.wordCount, order: chapters.length })
    } else {
      const cur = chapters[chapters.length - 1]
      cur.all.push(section)
      cur.wordCount += section.body.wordCount
    }
  }
  return chapters
}

export default function ReaderPage({ article, onBack }) {
  const { title, id: articleId } = article
  const kind = article.kind ?? 'article'

  // 归一化 sections：旧本地文章可能无 sections，合成单节退化实例
  const effectiveSections = useMemo(() => (
    (Array.isArray(article.sections) && article.sections.length > 0)
      ? article.sections
      : [{ id: 's_main', heading: null, depth: 0, order: 0, body: { text: article.text ?? '', markdown: article.markdown ?? null, wordCount: article.wordCount ?? 0 } }]
  ), [article])

  // 章分组 + 分流判据
  const chapters = useMemo(() => groupIntoChapters(effectiveSections), [effectiveSections])
  const isBook = kind === 'book'
  const paginated = isBook && chapters.length > 1        // 仅「书籍」且多章时逐章分页
  const sectionScoped = effectiveSections.length > 1     // 多 section → 按 section.id 关联书签/标记（与既有存储一致）
  const text = article.text ?? ''

  const [currentChapterIdx, setCurrentChapterIdx] = useState(0)
  const currentChapter = paginated ? (chapters[currentChapterIdx] ?? chapters[0]) : null
  // 当前呈现的 section 集合：分页取当前章；否则铺开全部 section（文章连续流）
  const flowSections = paginated ? currentChapter.all : effectiveSections

  // 使用统一段落解析，确保与 calcProgress 索引一致
  // !! 确保空字符串回退到 parseText（与 getParagraphs 内部的 truthy 检查一致）
  const paragraphs = useMemo(() =>
    article.markdown ? getParagraphs(article) : parseText(text)
  , [article.markdown, text])
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
  const [tocOpen, setTocOpen] = useState(false)
  const contentRef = useRef(null)
  const hideTimerRef = useRef(null)

  // 定位某 section 所属的章序号（book 分页跳转/恢复用）
  const chapterIdxOfSection = useCallback((sectionId) => {
    if (!sectionId) return -1
    return chapters.findIndex((ch) => ch.all.some((s) => s.id === sectionId))
  }, [chapters])

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
    if (!readingMark?.completed) return
    if (article.origin === 'featured' || article.origin === 'featured_legacy') {
      if (article.shareSourceId) {
        setRecSubmissionId(article.shareSourceId)
        if (userId) {
          getMyRating(article.shareSourceId, userId).then(rating => setRecRating(rating?.rating || null))
        }
      }
    }
  }, [readingMark?.completed, article.origin, article.shareSourceId, userId])

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

    // 派生选区所属 section（分节堆叠：从最近的 [data-section-id] 祖先读取）
    let sectionId = null
    if (sectionScoped) {
      let secEl = anchorEl
      while (secEl && secEl.dataset?.sectionId === undefined) {
        secEl = secEl.parentElement
      }
      sectionId = secEl?.dataset?.sectionId ?? null
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
      sectionId,
    })

    clear()
    translate(selected)
    if (showHint) {
      setShowHint(false)
      localStorage.setItem('readread_hint_dismissed', '1')
    }
  }, [translate, clear, paragraphs, showHint, sectionScoped])

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
        sectionId: popup.sectionId ?? null,
        sectionHeading: (popup.sectionId ? effectiveSections.find((s) => s.id === popup.sectionId)?.heading : null) ?? null,
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
  }, [popup, articleId, canUseCloudLibrary, loadReaderState, refreshAuthState, translateBookmark, userId, effectiveSections])


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

  // 跳转到某段落 — book 分页先切到目标章
  const handleJump = useCallback((paraIndex, sectionId) => {
    const scrollToPara = () => {
      const sel = sectionId
        ? `[data-section-id="${sectionId}"] [data-para-index="${paraIndex}"]`
        : `[data-para-index="${paraIndex}"]`
      const el = document.querySelector(sel)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    if (paginated && sectionId) {
      const chIdx = chapterIdxOfSection(sectionId)
      if (chIdx >= 0 && chIdx !== currentChapterIdx) {
        setCurrentChapterIdx(chIdx)
        setTimeout(scrollToPara, 200)
        return
      }
    }
    scrollToPara()
  }, [paginated, chapterIdxOfSection, currentChapterIdx])

  // book 分页切章时滚动到顶部
  useEffect(() => {
    if (paginated) {
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }, [currentChapterIdx, paginated])

  // 进度取整：0-10% 向上取整到 5/10，10%-100% 向下取整到整十
  function roundProgress(pct) {
    if (pct <= 0) return 0
    if (pct <= 10) return Math.ceil(pct / 5) * 5
    return Math.floor(pct / 10) * 10
  }

  // book 分页进度：已翻过章的全词数 + 当前章 scroll% × 当前章词数
  function calcBookProgressAtMark(scrollPercent) {
    const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0)
    if (totalWords === 0) return scrollPercent
    let cumulative = 0
    for (let i = 0; i < currentChapterIdx; i++) cumulative += chapters[i].wordCount
    cumulative += (chapters[currentChapterIdx]?.wordCount ?? 0) * (scrollPercent / 100)
    return Math.round((cumulative / totalWords) * 100)
  }

  const handleSetReadingMark = useCallback(async (paraIndex, sectionId = null) => {
    try {
      setLibraryError('')

      const scrollPercent = scrollPercentRef.current

      const options = {
        canUseCloudLibrary,
        userId,
      }

      // 文章连续流：直接取 top bar 滚动百分比
      // book 分页：按章 wordCount 加权
      const rawPercent = paginated ? calcBookProgressAtMark(scrollPercent) : scrollPercent
      const progressPercent = roundProgress(rawPercent)

      const isSameMark = readingMark?.paragraphIndex === paraIndex
        && (readingMark?.sectionId ?? null) === (sectionId ?? null)
        && !readingMark?.completed

      if (isSameMark) {
        const clearedMark = await clearReadingMark(articleId, options)
        setReadingMark(clearedMark)
      } else {
        const mark = await saveReadingMark(articleId, paraIndex, options, sectionId ?? null, progressPercent)
        setReadingMark(mark)
      }
    } catch (readingMarkError) {
      console.error('handleSetReadingMark error:', readingMarkError)
      if (isLibraryAccessError(readingMarkError)) {
        refreshAuthState()
      }

      setLibraryError(resolveLibraryErrorMessage(readingMarkError, '更新阅读进度失败，请稍后重试'))
    }
  }, [articleId, canUseCloudLibrary, readingMark, refreshAuthState, userId, paginated, chapters, currentChapterIdx])

  // 跳转后待 DOM 就绪再滚动（useEffect 监听 currentChapterIdx 变化）
  const pendingScrollRef = useRef(null)

  useEffect(() => {
    if (pendingScrollRef.current && currentChapterIdx === pendingScrollRef.current.targetIdx) {
      const timer = setTimeout(() => {
        const { paraIndex, sectionId } = pendingScrollRef.current
        const sel = sectionId
          ? `[data-section-id="${sectionId}"] [data-para-index="${paraIndex}"]`
          : `[data-para-index="${paraIndex}"]`
        const el = document.querySelector(sel)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        pendingScrollRef.current = null
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [currentChapterIdx])

  const handleJumpToReadingMark = useCallback(() => {
    if (!readingMark || readingMark.completed) return
    const { sectionId, paragraphIndex } = readingMark
    if (paginated && sectionId) {
      const chIdx = chapterIdxOfSection(sectionId)
      if (chIdx >= 0 && chIdx !== currentChapterIdx) {
        pendingScrollRef.current = { targetIdx: chIdx, paraIndex: paragraphIndex, sectionId }
        setCurrentChapterIdx(chIdx)
        return
      }
    }
    const sel = sectionId
      ? `[data-section-id="${sectionId}"] [data-para-index="${paragraphIndex}"]`
      : `[data-para-index="${paragraphIndex}"]`
    const el = document.querySelector(sel)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [readingMark, paginated, chapterIdxOfSection, currentChapterIdx])


  const handleReturnToShelf = useCallback(async () => {
    try {
      setLibraryError('')
      await returnToShelf(articleId, { completed: false, canUseCloudLibrary, userId })
      onBack()
    } catch (e) {
      if (isLibraryAccessError(e)) refreshAuthState()
      setLibraryError(resolveLibraryErrorMessage(e, '放回书架失败，请稍后重试'))
    }
  }, [articleId, canUseCloudLibrary, refreshAuthState, userId, onBack])

  const handleMarkCompleted = useCallback(async () => {
    try {
      setLibraryError('')

      const mark = await setReadingMarkCompleted(articleId, {
        canUseCloudLibrary,
        userId,
      })
      setReadingMark(mark)

      // D2 决策：标记读完后自动放回书架
      try {
        await returnToShelf(articleId, { completed: true, canUseCloudLibrary, userId })
      } catch (_) { /* 非致命——还书失败不影响阅读完成状态的更新 */ }

      onBack()
    } catch (markCompletedError) {
      if (isLibraryAccessError(markCompletedError)) {
        refreshAuthState()
      }

      setLibraryError(resolveLibraryErrorMessage(markCompletedError, '更新阅读完成状态失败，请稍后重试'))
    }
  }, [articleId, canUseCloudLibrary, refreshAuthState, userId, onBack])

  const isPopupBookmarked = popup
    ? bookmarks.some(
        (b) => b.text === popup.text
          && b.paragraphIndex === popup.paragraphIndex
          && (b.sectionId ?? null) === (popup.sectionId ?? null)
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

  const progressBarRef = useRef(null)
  const scrollPercentTextRef = useRef(null)
  const scrollPercentRef = useRef(0)
  const [headerVisible, setHeaderVisible] = useState(true)
  const lastScrollYRef = useRef(0)
  const tickingRef = useRef(false)

  useEffect(() => {
    const handleScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight
      const pct = scrollable > 0 ? Math.round((window.scrollY / scrollable) * 100) : 0
      scrollPercentRef.current = pct
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
    if (!readingMark || readingMark.completed) return
    const { sectionId, paragraphIndex } = readingMark
    // book 分页：若标记落在非当前章，先切章（由 pendingScroll 效应完成滚动）
    if (paginated && sectionId) {
      const chIdx = chapterIdxOfSection(sectionId)
      if (chIdx >= 0 && chIdx !== currentChapterIdx) {
        pendingScrollRef.current = { targetIdx: chIdx, paraIndex: paragraphIndex, sectionId }
        setCurrentChapterIdx(chIdx)
        return
      }
    }
    const timer = setTimeout(() => {
      const sel = sectionId
        ? `[data-section-id="${sectionId}"] [data-para-index="${paragraphIndex}"]`
        : `[data-para-index="${paragraphIndex}"]`
      const el = document.querySelector(sel)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 400)
    return () => clearTimeout(timer)
  }, [readingMark, paginated, chapterIdxOfSection, currentChapterIdx])

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
            <SectionFlow
              key={paginated ? currentChapter?.lead?.id : 'flow'}
              sections={flowSections}
              sectionScoped={sectionScoped}
              bookmarks={bookmarks}
              fontSize={fontSize}
              onHoverBookmark={showHoverCard}
              readingMark={readingMark}
              onSetReadingMark={handleSetReadingMark}
            />
          </div>

          {/* Chapter navigation — book 分页 */}
          {paginated && (
            <div className="flex items-center justify-between gap-3 mt-16 mb-4">
              <button
                disabled={currentChapterIdx === 0}
                onClick={() => setCurrentChapterIdx((i) => Math.max(0, i - 1))}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 transition-all"
                style={{ background: 'transparent', border: '1px solid var(--surface-border)', color: currentChapterIdx === 0 ? 'var(--border-subtle)' : 'var(--ink-muted)', fontSize: '13px', fontFamily: 'DM Sans', cursor: currentChapterIdx === 0 ? 'default' : 'pointer' }}
              >
                <ChevronLeft size={14} />上一章
              </button>
              <span style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)' }}>
                {currentChapterIdx + 1} / {chapters.length}
              </span>
              <button
                disabled={currentChapterIdx >= chapters.length - 1}
                onClick={() => setCurrentChapterIdx((i) => Math.min(chapters.length - 1, i + 1))}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 transition-all"
                style={{ background: 'transparent', border: '1px solid var(--surface-border)', color: currentChapterIdx >= chapters.length - 1 ? 'var(--border-subtle)' : 'var(--ink-muted)', fontSize: '13px', fontFamily: 'DM Sans', cursor: currentChapterIdx >= chapters.length - 1 ? 'default' : 'pointer' }}
              >
                下一章<ChevronRight size={14} />
              </button>
            </div>
          )}

          {/* 文档级结尾：仅文章连续流 或 书籍最后一章展示 */}
          {(!paginated || currentChapterIdx === chapters.length - 1) && (
            <>
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
            </>
          )}
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

      {/* Section TOC panel — book 分页按章跳转 */}
      {paginated && (
        <SectionTocPanel
          open={tocOpen}
          sections={effectiveSections}
          currentIdx={currentChapter?.lead?.order ?? 0}
          onSelect={(order) => {
            const sec = effectiveSections.find((s) => s.order === order)
            if (!sec) return
            const chIdx = chapterIdxOfSection(sec.id)
            const scrollToSec = () => {
              const el = document.querySelector(`[data-section-id="${sec.id}"]`)
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
            if (chIdx >= 0 && chIdx !== currentChapterIdx) {
              setCurrentChapterIdx(chIdx)
              setTimeout(scrollToSec, 200)
            } else {
              scrollToSec()
            }
          }}
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
