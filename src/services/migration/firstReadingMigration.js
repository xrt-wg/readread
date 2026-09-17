const KEYS = ['rr_articles', 'rr_bookmarks', 'rr_reading_marks']
const OWNER_KEY = 'rr_trial_migration_owner'

// Unknown/corrupt storage is never equivalent to an empty library.
export function readTrialSnapshot(storage) {
  const raw = Object.fromEntries(KEYS.map(key => [key, storage.getItem(key)]))
  const articles = JSON.parse(raw.rr_articles || '[]')
  const bookmarks = JSON.parse(raw.rr_bookmarks || '[]')
  const marks = JSON.parse(raw.rr_reading_marks || '{}')
  if (!Array.isArray(articles) || !Array.isArray(bookmarks) || !marks || Array.isArray(marks) || typeof marks !== 'object') {
    throw new Error('本地阅读数据格式异常，已保留原始数据')
  }
  if (articles.some(a => !a?.id || !a.title || !(a.text?.trim() || a.sections?.some(s => s.body?.text?.trim()))) ||
      bookmarks.some(b => !b?.id || !b.articleId || !b.text || !b.type) ||
      Object.values(marks).some(m => !m?.articleId)) {
    throw new Error('本地阅读数据不完整，已保留原始数据')
  }
  return { raw, articles, bookmarks, marks: Object.values(marks), empty: !articles.length && !bookmarks.length && !Object.keys(marks).length }
}

async function checked(request) {
  const result = await (request.abortSignal ? request.abortSignal(AbortSignal.timeout(15000)) : request)
  if (result.error) throw result.error
  return result.data
}

// Insert-only retries preserve cloud progress and resolve partial earlier imports.
export async function migrateTrialSnapshot({ storage, client, userId, mapReading }) {
  const snapshot = readTrialSnapshot(storage)
  if (snapshot.empty) return
  const owner = storage.getItem(OWNER_KEY)
  if (owner && owner !== userId) throw new Error('本地阅读数据等待原账号同步，已保留数据')
  storage.setItem(OWNER_KEY, userId)
  const { articles, bookmarks, marks } = snapshot
  if (articles.length) {
    const active = await checked(client.from('readings').select('id').eq('user_id', userId).eq('reading_status', 'reading').is('deleted_at', null))
    const activeIds = new Set(active.map(row => row.id))
    let slots = Math.max(0, 5 - activeIds.size)
    const rows = articles.map(article => {
      const row = mapReading(article, userId)
      if (row.reading_status === 'reading' && !activeIds.has(row.id)) {
        if (slots > 0) slots--
        else row.reading_status = 'in_progress'
      }
      if (!row.sections?.length && article.text) {
        row.sections = [{ id: 's_main', heading: null, depth: 0, parentId: null, order: 0,
          body: { text: article.text, markdown: article.markdown || null, wordCount: article.text.split(/\s+/).filter(Boolean).length } }]
      }
      return row
    })
    await checked(client.from('readings').upsert(rows, { onConflict: 'id', ignoreDuplicates: true }))
  }
  const ids = [...new Set([...articles.map(a => a.id), ...bookmarks.map(b => b.articleId), ...marks.map(m => m.articleId)])]
  const owned = ids.length ? await checked(client.from('readings').select('id').eq('user_id', userId).is('deleted_at', null).in('id', ids)) : []
  if (owned.length !== ids.length) throw new Error('部分本地文章尚未同步，已保留数据以便重试')
  if (bookmarks.length) {
    await checked(client.from('bookmarks').upsert(bookmarks.map(b => ({
      id: b.id, user_id: userId, reading_id: b.articleId, type: b.type, text: b.text,
      translation: b.translation ?? null, translation_provider: b.translationProvider ?? null,
      context_sentence: b.contextSentence ?? null, context_translation: b.contextTranslation ?? null,
      translation_status: b.translationStatus ?? 'pending', paragraph_index: b.paragraphIndex ?? null,
      char_offset: b.charOffset ?? null, review_count: b.reviewCount ?? 0, next_review_at: b.nextReviewAt ?? null,
      familiarity: b.familiarity ?? 0, section_id: b.sectionId ?? null, section_heading: b.sectionHeading ?? null,
    })), { onConflict: 'id', ignoreDuplicates: true }))
    const saved = await checked(client.from('bookmarks').select('id').eq('user_id', userId).in('id', bookmarks.map(b => b.id)))
    if (saved.length !== new Set(bookmarks.map(b => b.id)).size) throw new Error('部分收藏尚未同步，已保留本地数据')
  }
  if (marks.length) {
    await checked(client.from('reading_marks').upsert(marks.map(m => ({
      user_id: userId, reading_id: m.articleId, paragraph_index: m.paragraphIndex ?? null,
      completed: Boolean(m.completed), section_id: m.sectionId ?? null,
      completed_sections: m.completedSections ?? [], progress_percent: m.progressPercent ?? null,
    })), { onConflict: 'user_id,reading_id', ignoreDuplicates: true }))
  }
  // Do not discard data added by another tab while this request was in flight.
  if (KEYS.some(key => storage.getItem(key) !== snapshot.raw[key])) throw new Error('本地阅读数据已更新，请重试同步')
  for (const key of KEYS) storage.removeItem(key)
  storage.removeItem('rr_local_migration_meta')
  storage.removeItem(OWNER_KEY)
}
