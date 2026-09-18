import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Star, ScanEye, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useDirectTranslation } from '../hooks/useDirectTranslation'
import { useBookmarkAI } from '../hooks/useBookmarkAI'
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
import { detectSelectionType, findContainingSentence } from '../utils/textUtils'
import { createBookmark } from '../store/storage'
import { getParagraphs } from '../services/progress'

/**
 * 块级内容标签——选区定位时，即使这些元素没有 data-para-index，
 * 也应将其视为有效的内容容器停止上溯，避免一路走到 null。
 */
const CONTENT_BLOCK_TAGS = new Set([
  'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'TD', 'TH', 'BLOCKQUOTE', 'PRE', 'FIGCAPTION',
])

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

/**
 * 计算 DOM Range 起点在容器 textContent 中的字符偏移量。
 * 通过 TreeWalker 累加文本节点长度，避免旧 getCharOffset 的 indexOf 首现错位。
 */
function getSelectionStartOffset(containerEl, range) {
  if (!containerEl || !range) return 0
  const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT)
  let offset = 0
  let node
  while ((node = walker.nextNode())) {
    if (node === range.startContainer) return offset + range.startOffset
    offset += node.textContent.length
  }
  return 0 // 兜底：startContainer 非文本节点等罕见情况
}

/**
 * 判断两个收藏是否指向「同一位置同一词语」。
 * 位置 = paragraphIndex + sectionId + charOffset，词语 = text。
 * 同一词形在不同位置（不同语境）是不同学习对象，不去重；
 * 同一词形在同一位置才是同一处，不重复收藏。
 */
function isSameBookmarkLocation(a, b) {
  return a.text === b.text
    && a.paragraphIndex === b.paragraphIndex
    && (a.sectionId ?? null) === (b.sectionId ?? null)
    && (a.charOffset ?? null) === (b.charOffset ?? null)
}

export default function ReaderPage({ article, onBack, fabCollapsed = false, onFabCollapsedChange }) {
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
  const [preReadMode, setPreReadMode] = useState(false)
  const contentRef = useRef(null)
  const hideTimerRef = useRef(null)

  // 定位某 section 所属的章序号（book 分页跳转/恢复用）
  const chapterIdxOfSection = useCallback((sectionId) => {
    if (!sectionId) return -1
    return chapters.findIndex((ch) => ch.all.some((s) => s.id === sectionId))
  }, [chapters])

  const showHoverCard = useCallback((bm, el) => {
    if (preReadMode) return                    // 预读模式下禁用收藏悬浮卡
    clearTimeout(hideTimerRef.current)
    if (bm) setHoverBookmark({ bookmark: bm, el })
    else hideTimerRef.current = setTimeout(() => setHoverBookmark(null), 150)
  }, [preReadMode])

  const { result, loading, error, translate, clear } = useDirectTranslation()
  const { translateBookmark } = useBookmarkAI()

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

  // F2（问题12修复）：拖选途中延迟落地收藏状态。
  // 内容区 mousedown→mouseup 之间为「选区活跃」窗口；期间收藏管线的状态刷新只置 dirty 标志，
  // 待 mouseup 后统一 loadReaderState 一次（天然规避两波排队去重与预读时序问题）。
  // 兜底：窗外松手（全局 mouseup capture）/ 窗口 blur / 5s 超时。flush 经 setTimeout(0)
  // 延迟到当前 mouseup 事件的全部监听器完成之后，确保 handleMouseUp 已同步捕获选区。
  const selectingRef = useRef(false)
  const readerStateDirtyRef = useRef(false)
  const flushTimerRef = useRef(null)

  const flushReaderState = useCallback(() => {
    if (!readerStateDirtyRef.current) return
    readerStateDirtyRef.current = false
    clearTimeout(flushTimerRef.current)
    setTimeout(() => { loadReaderState() }, 0)
  }, [loadReaderState])

  const refreshReaderState = useCallback(async () => {
    if (selectingRef.current) {
      readerStateDirtyRef.current = true
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = setTimeout(() => {
        selectingRef.current = false
        flushReaderState()
      }, 5000)
      return
    }
    await loadReaderState()
  }, [loadReaderState, flushReaderState])

  useEffect(() => {
    const onDown = (e) => {
      if (contentRef.current?.contains(e.target)) selectingRef.current = true
    }
    const onUp = () => {
      if (!selectingRef.current) return
      selectingRef.current = false
      flushReaderState()
    }
    const onBlur = () => {
      selectingRef.current = false
      flushReaderState()
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('mouseup', onUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('mouseup', onUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [flushReaderState])

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

  const closePopup = useCallback(() => {
    setPopup(null)
    clear()
    window.getSelection()?.removeAllRanges()
  }, [clear])

  // 首用引导提示：首次成功划选或点击关闭按钮后永久关闭（按设备 localStorage 记忆）
  const dismissHint = useCallback(() => {
    if (localStorage.getItem('readread_hint_dismissed')) return
    setShowHint(false)
    localStorage.setItem('readread_hint_dismissed', '1')
  }, [])

  const handleMouseUp = useCallback(async (event) => {
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

    // 首次成功划选即视为已了解划选交互（普通/预读模式皆可），关闭首用引导提示
    dismissHint()

    const rect = range.getBoundingClientRect()
    const selType = detectSelectionType(selected)
    const isShort = selType === 'word' || selType === 'phrase'

    // 找到选中文本所在的段落
    let paraIndex = 0
    let anchorEl = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer
    while (anchorEl && anchorEl.dataset?.paraIndex === undefined
           && !CONTENT_BLOCK_TAGS.has(anchorEl.tagName)) {
      anchorEl = anchorEl.parentElement
    }
    if (anchorEl?.dataset?.paraIndex !== undefined) {
      paraIndex = parseInt(anchorEl.dataset.paraIndex)
    } else if (anchorEl && CONTENT_BLOCK_TAGS.has(anchorEl.tagName)) {
      // 回退：选区落在非段落块级内容上（如标题 / 表格单元格）
      // -1 表示"非 paragraphs 索引"——跳转时静默跳过
      paraIndex = -1
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

    const paraText = (anchorEl?.textContent) || (paragraphs[paraIndex >= 0 ? paraIndex : 0] ?? '')
    const contextSentence = isShort ? findContainingSentence(paraText, selected) : null
    const rawSelection = selection.toString()
    const charOffset =
      getSelectionStartOffset(anchorEl, range) +
      (rawSelection.length - rawSelection.trimStart().length)

    // 预读模式：划词即收藏，无弹窗
    if (preReadMode) {
      window.getSelection()?.removeAllRanges()
      // 位置去重：同一位置同一词语已收藏则跳过（不重复保存）
      const alreadyBookmarked = bookmarks.some((b) =>
        isSameBookmarkLocation(b, { text: selected, paragraphIndex: paraIndex, sectionId, charOffset }))
      if (alreadyBookmarked) return
      try {
        const bm = createBookmark({
          type: selType,
          text: selected,
          contextSentence: contextSentence ?? null,
          articleId,
          paragraphIndex: paraIndex,
          charOffset,
          sectionId: sectionId ?? null,
          sectionHeading: (sectionId ? effectiveSections.find((s) => s.id === sectionId)?.heading : null) ?? null,
        })
        const savedBookmark = await saveBookmark(bm, { canUseCloudLibrary, userId })
        await refreshReaderState()
        translateBookmark(savedBookmark, async () => {
          await refreshReaderState()
        })
      } catch (e) {
        if (isLibraryAccessError(e)) refreshAuthState()
        setLibraryError(resolveLibraryErrorMessage(e, '收藏失败'))
      }
      return
    }

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
  }, [preReadMode, translate, clear, paragraphs, dismissHint, sectionScoped, articleId, bookmarks, canUseCloudLibrary, userId, refreshReaderState, translateBookmark, effectiveSections, refreshAuthState])

  const handleBookmark = useCallback(async () => {
    if (!popup) return
    const { text, selectionType, contextSentence, paragraphIndex, charOffset, sectionId } = popup

    // 位置去重：同一位置同一词语已收藏则不再保存
    const alreadyBookmarked = bookmarks.some((b) =>
      isSameBookmarkLocation(b, { text, paragraphIndex, sectionId, charOffset }))

    // 收藏后同步关闭弹窗，避免连点（按钮随弹窗一并移除）
    closePopup()

    if (alreadyBookmarked) return

    try {
      setLibraryError('')

      const bm = createBookmark({
        type: selectionType,
        text,
        contextSentence: contextSentence ?? null,
        articleId,
        paragraphIndex,
        charOffset,
        sectionId: sectionId ?? null,
        sectionHeading: (sectionId ? effectiveSections.find((s) => s.id === sectionId)?.heading : null) ?? null,
      })
      const options = {
        canUseCloudLibrary,
        userId,
      }

      const savedBookmark = await saveBookmark(bm, options)
      await refreshReaderState()
      translateBookmark(savedBookmark, async () => {
        await refreshReaderState()
      })
    } catch (bookmarkError) {
      if (isLibraryAccessError(bookmarkError)) {
        refreshAuthState()
      }

      setLibraryError(resolveLibraryErrorMessage(bookmarkError, '保存收藏失败，请稍后重试'))
    }
  }, [popup, bookmarks, closePopup, articleId, canUseCloudLibrary, refreshReaderState, refreshAuthState, translateBookmark, userId, effectiveSections])

  const handleTogglePreRead = useCallback(async (newMode) => {
    setPreReadMode(newMode)
    if (!newMode) {
      const pending = bookmarks.filter(b => b.translationStatus === 'pending')
      for (const bm of pending) {
        try {
          await translateBookmark(bm, async () => {})
        } catch { /* 单个失败不阻塞后续 */ }
      }
      await loadReaderState()
    }
  }, [bookmarks, translateBookmark, loadReaderState])


  const handleDeleteBookmark = useCallback(async (id) => {
    try {
      setLibraryError('')

      const options = {
        canUseCloudLibrary,
        userId,
      }

      await deleteBookmark(id, options)
      await refreshReaderState()
      setHoverBookmark(null)
    } catch (deleteError) {
      if (isLibraryAccessError(deleteError)) {
        refreshAuthState()
      }

      setLibraryError(resolveLibraryErrorMessage(deleteError, '删除收藏失败，请稍后重试'))
    }
  }, [articleId, canUseCloudLibrary, refreshReaderState, refreshAuthState, userId])

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
  // 追踪阅读标记位置（按值），防止 collection refresh 误触发滚动
  const prevMarkRef = useRef({ paragraphIndex: null, sectionId: null })

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

      // 来自推荐区的内容：读完停留展示评分入口，由用户评分后手动返回；
      // 其余内容维持原 D2 行为（读完即返回书架）。
      // 停留条件与评分组件渲染条件（origin + shareSourceId 双条件）严格对齐，
      // 避免 origin 命中但 share_source_id 缺失时出现「停留却无评分」的边界态
      const fromRecommendation =
        (article.origin === 'featured' || article.origin === 'featured_legacy') &&
        article.shareSourceId
      if (!fromRecommendation) {
        onBack()
      }
    } catch (markCompletedError) {
      if (isLibraryAccessError(markCompletedError)) {
        refreshAuthState()
      }

      setLibraryError(resolveLibraryErrorMessage(markCompletedError, '更新阅读完成状态失败，请稍后重试'))
    }
  }, [articleId, canUseCloudLibrary, refreshAuthState, userId, onBack, article.origin, article.shareSourceId])

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

  // 预读模式快捷键：按 A 快速开/关（避开 Ctrl/Cmd/Alt 组合键与输入框焦点）
  useEffect(() => {
    const handlePreReadKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'a' && e.key !== 'A') return
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return
      e.preventDefault()
      handleTogglePreRead(!preReadMode)
    }
    document.addEventListener('keydown', handlePreReadKey)
    return () => document.removeEventListener('keydown', handlePreReadKey)
  }, [preReadMode, handleTogglePreRead])

  // 收藏列表弹出时收起右下角悬浮按钮组（正常态保持展开）
  useEffect(() => {
    onFabCollapsedChange?.(panelOpen)
  }, [panelOpen, onFabCollapsedChange])

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

    // 仅当标记位置实际变化时才滚动，忽略对象引用刷新
    if (
      prevMarkRef.current.paragraphIndex === paragraphIndex &&
      (prevMarkRef.current.sectionId ?? null) === (sectionId ?? null)
    ) {
      return
    }
    prevMarkRef.current = { paragraphIndex, sectionId }

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
      {/* Reading progress bar — always visible, aligned to text column */}
      <div className="px-6" style={{ position: 'sticky', top: 0, zIndex: 50, pointerEvents: 'none' }}>
        <div style={{ maxWidth: '680px', margin: '0 auto', height: '3px', background: 'var(--border-subtle)', borderRadius: '999px' }}>
          <div
            ref={progressBarRef}
            style={{ height: '100%', width: '0%', background: 'var(--gold)', opacity: 0.85, borderRadius: '999px' }}
          />
        </div>
      </div>

      <ReaderHeader
        headerVisible={headerVisible}
        onBack={onBack}
        scrollPercentTextRef={scrollPercentTextRef}
        paginated={paginated}
        tocOpen={tocOpen}
        setTocOpen={setTocOpen}
        currentChapterIdx={currentChapterIdx}
        chapters={chapters}
        readingMark={readingMark}
        handleJumpToReadingMark={handleJumpToReadingMark}
        fontSize={fontSize}
        setFontSize={setFontSize}
        fontSizeOpen={fontSizeOpen}
        setFontSizeOpen={setFontSizeOpen}
        fontSizeRef={fontSizeRef}
      />

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
      <main className="px-6 pb-24" style={{ paddingTop: 'clamp(48px, 8vh, 96px)' }}>
        <div style={{ maxWidth: '680px', margin: '0 auto' }}>
          {libraryError ? (
            <div className="mb-6 rounded-2xl px-4 py-3 text-sm" style={{ border: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.08)', color: 'var(--ink)' }}>
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
                  flex: 1,
                }}
              >
                划选可看<strong>翻译</strong>、随手<strong>收藏</strong>；开启<strong>预读模式</strong>（快捷键 A），划选即收藏、不打断阅读。
              </p>
              <button
                onClick={dismissHint}
                aria-label="关闭提示"
                className="rounded-full flex items-center justify-center shrink-0 transition-all"
                style={{
                  width: 24,
                  height: 24,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--gold-dark)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196,154,60,0.12)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <X size={14} />
              </button>
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
            <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
            <span style={{ fontSize: '18px', opacity: 0.4 }}>✦</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
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
              <div className="flex flex-col items-center gap-3">
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
                <div className="flex items-center justify-center gap-2">
                  <span style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', marginRight: '4px' }}>评分：</span>
                  {['recommend', 'average', 'not_good'].map(r => {
                    const labels = { recommend: '推荐', average: '一般', not_good: '不行' }
                    const isActive = recRating === r
                    return (
                      <button key={r} onClick={() => handleRecRate(r)} disabled={recRatingLoading}
                        style={{
                          fontSize: '11px', fontFamily: 'DM Sans', fontWeight: isActive ? 600 : 400,
                          border: `1px solid ${isActive ? 'var(--gold-dark)' : 'var(--surface-border)'}`,
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

              <button
                onClick={onBack}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 transition-all"
                style={{
                  background: 'var(--surface-bg)',
                  border: '1px solid var(--surface-border)',
                  color: 'var(--ink-muted)',
                  fontSize: '13px',
                  fontFamily: 'DM Sans',
                  cursor: 'pointer',
                }}
              >
                返回书架
              </button>
              </div>
            ) : (
              <button
                onClick={handleMarkCompleted}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 transition-all"
                style={{
                  background: 'var(--surface-bg)',
                  border: '1px solid var(--surface-border)',
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
                  e.currentTarget.style.background = 'var(--surface-bg)'
                  e.currentTarget.style.borderColor = 'var(--surface-border)'
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
          />
        </div>
      )}

      {/* Bookmark hover card */}
      {hoverBookmark && !popup && !preReadMode && (
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

      {/* Floating reader controls — 收藏 / 预读，叠于全局主题按钮之上（主题在 App 右下角） */}
      <div style={{ position: 'fixed', right: '20px', bottom: '124px', zIndex: 50, display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', pointerEvents: fabCollapsed ? 'none' : 'auto' }}>
        <button
          onClick={() => setPanelOpen(v => !v)}
          title="收藏"
          className="relative flex items-center justify-center rounded-full transition-all"
          style={{
            width: 40, height: 40,
            background: panelOpen ? 'var(--ink)' : 'var(--popup-bg)',
            border: `1px solid ${panelOpen ? 'var(--ink)' : 'var(--popup-border)'}`,
            boxShadow: 'var(--popup-shadow)',
            color: panelOpen ? 'var(--on-ink)' : 'var(--ink-muted)',
            cursor: 'pointer',
            opacity: fabCollapsed ? 0 : 1,
            transform: fabCollapsed ? 'translateY(152px) scale(0.3)' : 'translateY(0) scale(1)',
            pointerEvents: fabCollapsed ? 'none' : 'auto',
          }}
          onMouseEnter={(e) => { if (!panelOpen) { e.currentTarget.style.background = 'var(--hover-bg)'; e.currentTarget.style.color = 'var(--ink)' } }}
          onMouseLeave={(e) => { if (!panelOpen) { e.currentTarget.style.background = 'var(--popup-bg)'; e.currentTarget.style.color = 'var(--ink-muted)' } }}
        >
          <Star size={16} />
          {bookmarks.length > 0 && (
            <span style={{ position: 'absolute', top: -4, right: -6, fontSize: '9px', fontWeight: 600,
              background: panelOpen ? 'var(--on-ink)' : 'var(--ink)', color: panelOpen ? 'var(--ink)' : 'var(--on-ink)',
              borderRadius: '7px', padding: '1px 4px', lineHeight: 1.4 }}>
              {bookmarks.length}
            </span>
          )}
        </button>

        <button
          onClick={() => handleTogglePreRead(!preReadMode)}
          title={preReadMode ? '关闭预读模式（快捷键 A）' : '预读模式：划词即收藏，无弹窗（快捷键 A）'}
          className="flex items-center justify-center rounded-full transition-all"
          style={{
            width: 40, height: 40,
            background: preReadMode ? 'rgba(196,154,60,0.18)' : 'var(--popup-bg)',
            border: `1px solid ${preReadMode ? 'rgba(196,154,60,0.45)' : 'var(--popup-border)'}`,
            boxShadow: 'var(--popup-shadow)',
            color: preReadMode ? 'var(--gold)' : 'var(--ink-muted)',
            cursor: 'pointer',
            opacity: fabCollapsed ? 0 : 1,
            transform: fabCollapsed ? 'translateY(104px) scale(0.3)' : 'translateY(0) scale(1)',
            pointerEvents: fabCollapsed ? 'none' : 'auto',
          }}
          onMouseEnter={(e) => { if (!preReadMode) { e.currentTarget.style.background = 'var(--hover-bg)'; e.currentTarget.style.color = 'var(--ink)' } }}
          onMouseLeave={(e) => { if (!preReadMode) { e.currentTarget.style.background = 'var(--popup-bg)'; e.currentTarget.style.color = 'var(--ink-muted)' } }}
        >
          <ScanEye size={16} />
        </button>
      </div>
    </div>
  )
}
