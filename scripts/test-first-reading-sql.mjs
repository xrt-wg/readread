import { fixtureSchema } from './first-reading-test-schema.mjs'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

// Isolated PostgreSQL engine, never connects to the configured Supabase project.
const { PGlite } = await import(pathToFileURL(process.argv[2] || `${process.cwd()}/.tmp-first-reading-validation/node_modules/@electric-sql/pglite/dist/index.js`))
const db = new PGlite()
await db.exec(await fixtureSchema())
await db.exec(await readFile('supabase/migrations/20260917000003_first_reading_offer.sql', 'utf8'))
let assertions = 0
const check = (actual, expected) => { assert.deepEqual(actual, expected); assertions++ }
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const actor = async n => {
  const id = `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
  await db.query('insert into auth.users values($1) on conflict do nothing', [id])
  await db.query('insert into profiles(user_id) values($1) on conflict do nothing', [id])
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id])
  return id
}
const offer = async () => (await one('select get_first_reading_offer() value')).value
const choose = async id => (await one('select choose_first_reading_offer($1) value',[id])).value
const u1 = await actor(1)
check((await offer()).items, [])
const sections = [{ heading: 'Start', depth: 0, body: { text: 'One two three', markdown: 'One two three' } },
 { heading: 'Child', depth: 1, body: { text: 'Four five', markdown: null } }]
for (const id of ['a','b']) {
  await db.query("insert into recommendation_submissions(id,status,intro) values($1,'active','A short introduction')", [id])
  await db.query("insert into recommendation_submission_snapshots values($1,$2,null,null,$3,'markdown','cover','en','book')",[id,`Article ${id}`,JSON.stringify(sections)])
}
await db.exec("update first_reading_config set enabled=true,submission_a='a',submission_b='b'")
check((await offer()).items.length,2)
check((await offer()).items[0].wordCount,5)
await assert.rejects(() => choose('not-configured')); assertions++
const result = await choose('a')
check(result.status,'chosen')
check((await choose('b')).readingId,result.readingId)
check((await one('select dismiss_first_reading_offer() value')).value.status,'chosen')
const reading = await one('select * from readings where id=$1',[result.readingId])
check([reading.kind,reading.cover_url,reading.origin,reading.share_source_id,reading.reading_status],['book','cover','featured','a','reading'])
check(reading.sections[1].parentId,'s_0')
check(reading.total_word_count,5)
check((await one("select add_count from recommendation_submissions where id='a'")).add_count,1)
check((await one('select count(*)::int n from readings where user_id=$1',[u1])).n,1)
await db.query('update readings set deleted_at=now() where id=$1',[result.readingId])
check((await offer()).status,'chosen')
check((await choose('a')).readingId,result.readingId)
const u2 = await actor(2)
check((await one('select dismiss_first_reading_offer() value')).value.status,'dismissed')
check((await choose('a')).status,'dismissed')
check((await one('select count(*)::int n from readings where user_id=$1',[u2])).n,0)
const u3 = await actor(3)
await db.query("insert into readings(id,user_id,title) values('manual',$1,'Manual')",[u3])
check((await offer()).status,'suppressed')
await db.query("delete from readings where id='manual'")
check((await offer()).status,'suppressed')
const u4 = await actor(4)
await db.exec("update recommendation_submissions set status='removed' where id='b'")
check((await offer()).items,[])
await assert.rejects(() => choose('a')); assertions++
check((await offer()).status,'pending')
await db.exec("update recommendation_submissions set status='active' where id='b'")
await db.exec("create function test_fail() returns trigger language plpgsql as $$begin raise exception 'test rollback'; end$$; create trigger test_fail before update on recommendation_submissions for each row execute function test_fail()")
await assert.rejects(() => choose('a')); assertions++
check((await one('select count(*)::int n from readings where user_id=$1',[u4])).n,0)
check((await offer()).status,'pending')
await db.exec('drop trigger test_fail on recommendation_submissions')
const u5 = await actor(5)
for (let i=0;i<5;i++) await db.query("insert into readings(id,user_id,title,reading_status) values($1,$2,'Active','reading')",[`active-${i}`,u5])
await assert.rejects(() => db.query("insert into readings(id,user_id,title,reading_status) values('six',$1,'Six','reading')",[u5])); assertions++
await db.query("select start_reading('active-0',$1,999)",[u5])
check((await one('select count(*)::int n from readings where user_id=$1',[u5])).n,5)
await db.query('delete from auth.users where id=$1',[u5])
check((await one('select count(*)::int n from user_first_reading_states where user_id=$1',[u5])).n,0)
await actor(6)
await db.exec('set role authenticated')
check((await offer()).status,'pending')
await assert.rejects(() => db.exec("update first_reading_config set enabled=false")); assertions++
await assert.rejects(() => db.exec("select first_reading_cards()")); assertions++
check((await one('select count(*)::int n from user_first_reading_states')).n,1)
await db.exec('reset role; set role anon')
await assert.rejects(() => offer()); assertions++
await db.exec('reset role')
console.log(`PASS: ${assertions} isolated PostgreSQL assertions; real multi-connection concurrency remains separate.`)
await db.close()
