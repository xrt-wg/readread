import assert from 'node:assert/strict'
import { readTrialSnapshot, migrateTrialSnapshot } from '../src/services/migration/firstReadingMigration.js'

const article = { id: 'trial', title: 'Trial', text: 'One two', readingStatus: 'reading' }
const bookmark = { id: 'bookmark', articleId: 'trial', text: 'One', type: 'word' }
const mark = { articleId: 'trial', paragraphIndex: 1, completed: false }
function storage() {
  const values = new Map(Object.entries({ rr_articles: JSON.stringify([article]), rr_bookmarks: JSON.stringify([bookmark]), rr_reading_marks: JSON.stringify({ trial: mark }) }))
  return { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) }
}
function client() {
  const tables = { readings: [], bookmarks: [], reading_marks: [] }
  const api = { tables, failure: null, mutate: null, from(table) {
    const filters = []; let rows
    const q = {
      select() { return q }, eq(k,v) { filters.push(r => r[k] === v); return q },
      is(k,v) { filters.push(r => (r[k] ?? null) === v); return q }, in(k,v) { filters.push(r => v.includes(r[k])); return q },
      upsert(input, options) { assert.equal(options.ignoreDuplicates,true); rows=input; return q },
      then(resolve,reject) { return Promise.resolve().then(() => {
        if (rows) {
          if (api.failure === table) return { error: new Error('injected failure'), data: null }
          for (const row of rows) {
            const same = table === 'reading_marks' ? r => r.user_id === row.user_id && r.reading_id === row.reading_id : r => r.id === row.id
            if (!tables[table].some(same)) tables[table].push(structuredClone(row))
          }
          api.mutate?.(table)
          return { data: null }
        }
        return { data: tables[table].filter(r => filters.every(f => f(r))) }
      }).then(resolve,reject) },
    }
    return q
  } }
  return api
}
const mapReading = (a,u) => ({ id:a.id,user_id:u,title:a.title,sections:a.sections || [],reading_status:a.readingStatus || 'unread' })
let count=0
for (const table of ['readings','bookmarks','reading_marks']) {
  const store=storage(), db=client()
  db.failure=table
  await assert.rejects(() => migrateTrialSnapshot({storage:store,client:db,userId:'u',mapReading}))
  assert.ok(store.getItem('rr_articles')); assert.ok(store.getItem('rr_bookmarks')); assert.ok(store.getItem('rr_reading_marks'))
  db.failure=null
  await migrateTrialSnapshot({storage:store,client:db,userId:'u',mapReading})
  assert.equal(readTrialSnapshot(store).empty,true)
  assert.equal(db.tables.readings.length,1); assert.equal(db.tables.bookmarks.length,1); assert.equal(db.tables.reading_marks.length,1)
  count++
}
{
  const store=storage(),db=client()
  db.tables.readings.push({id:'trial',user_id:'u',reading_status:'reading',title:'Cloud newer'})
  db.tables.reading_marks.push({user_id:'u',reading_id:'trial',paragraph_index:99,completed:true})
  await migrateTrialSnapshot({storage:store,client:db,userId:'u',mapReading})
  assert.equal(db.tables.readings[0].title,'Cloud newer'); assert.equal(db.tables.reading_marks[0].paragraph_index,99)
  count++
}
{
  const store=storage(),db=client()
  db.mutate=table => { if(table==='reading_marks') store.setItem('rr_articles', JSON.stringify([article,{...article,id:'new'}])) }
  await assert.rejects(() => migrateTrialSnapshot({storage:store,client:db,userId:'u',mapReading}), /已更新/)
  assert.ok(store.getItem('rr_articles')); count++
}
{
  const store=storage(); store.setItem('rr_articles','bad json')
  assert.throws(() => readTrialSnapshot(store)); count++
}
{
  const store=storage(); store.setItem('rr_trial_migration_owner','other')
  await assert.rejects(() => migrateTrialSnapshot({storage:store,client:client(),userId:'u',mapReading}),/原账号/); count++
}
{
  const store=storage(),db=client()
  for(let i=0;i<5;i++) db.tables.readings.push({id:`existing${i}`,user_id:'u',reading_status:'reading'})
  await migrateTrialSnapshot({storage:store,client:db,userId:'u',mapReading})
  assert.equal(db.tables.readings.find(r=>r.id==='trial').reading_status,'in_progress'); count++
}
console.log(`PASS: ${count} migration scenarios (partial failure, retry, preservation, malformed storage, account isolation, capacity).`)
