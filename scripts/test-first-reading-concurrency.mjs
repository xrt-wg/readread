import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { fixtureSchema } from './first-reading-test-schema.mjs'

// Disposable, loopback-only native PostgreSQL. Does not read .env or touch Supabase.
const base = resolve('.tmp-first-reading-validation/node_modules')
const { initdb, pg_ctl } = await import(pathToFileURL(`${base}/@embedded-postgres/windows-x64/dist/index.js`))
const { default: pg } = await import(pathToFileURL(`${base}/pg/lib/index.js`))
const dir = resolve(`${base}/.cache/first-reading-${Date.now()}`)
assert.ok(dir.startsWith(`${base}`))
await mkdir(dir, { recursive: true })
function run(exe, args) {
  return new Promise((done, reject) => {
    const child = spawn(exe, args, { windowsHide: true })
    let output = ''
    child.stdout.on('data', c => { output += c })
    child.stderr.on('data', c => { output += c })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? done(output) : reject(new Error(output)))
  })
}
const clients=[]
let started=false
const u=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
try {
  await run(initdb,['-D',dir,'-U','postgres','-A','trust','--locale=C','--encoding=UTF8'])
  await run(pg_ctl,['-D',dir,'-l',`${dir}/server.log`,'-o','-h 127.0.0.1 -p 55439','-w','start'])
  started=true
  async function connect() {
    const c=new pg.Client({host:'127.0.0.1',port:55439,user:'postgres',database:'postgres'})
    await c.connect(); clients.push(c); await c.query("set statement_timeout='8s'"); return c
  }
  const admin=await connect(), a=await connect(), b=await connect()
  await admin.query(await fixtureSchema())
  await admin.query(await readFile('supabase/migrations/20260917000003_first_reading_offer.sql','utf8'))
  for(let n=1;n<=12;n++) {
    await admin.query('insert into auth.users values($1)',[u(n)])
    await admin.query('insert into profiles(user_id) values($1)',[u(n)])
  }
  await admin.query("insert into recommendation_submissions(id,status,intro) values('a','active','First'),('b','active','Second')")
  for(const id of ['a','b']) await admin.query("insert into recommendation_submission_snapshots values($1,$1,null,null,$2,'markdown',null,'en','article')",[id,JSON.stringify([{depth:0,body:{text:'Hello world',markdown:null}}])])
  await admin.query("update first_reading_config set enabled=true,submission_a='a',submission_b='b'")
  async function identity(c,n) { await c.query("select set_config('request.jwt.claim.sub',$1,false)",[u(n)]) }
  const choose=(c,id)=>c.query('select choose_first_reading_offer($1) value',[id]).then(r=>r.rows[0].value)
  // Two independent connections simultaneously choose different cards.
  await identity(a,1); await identity(b,1)
  const [first,second]=await Promise.all([choose(a,'a'),choose(b,'b')])
  assert.equal(first.readingId,second.readingId)
  assert.equal((await admin.query('select count(*)::int n from readings where user_id=$1',[u(1)])).rows[0].n,1)
  // Ordinary import owns the account lock until commit. choose must wait and suppress.
  await identity(a,2); await identity(b,2)
  await a.query('begin')
  await a.query("insert into readings(id,user_id,title) values('manual',$1,'Manual')",[u(2)])
  const pending=choose(b,'a')
  await a.query('commit')
  assert.equal((await pending).status,'suppressed')
  // Dismiss wins when committed first; choose cannot create a record.
  await identity(a,3); await identity(b,3)
  await a.query('begin'); await a.query('select dismiss_first_reading_offer()')
  const dismissed=choose(b,'a'); await a.query('commit')
  assert.equal((await dismissed).status,'dismissed')
  // Two direct writes compete for the last reading slot (migration participates via trigger).
  for(let i=0;i<4;i++) await admin.query("insert into readings(id,user_id,title,reading_status) values($1,$2,'Existing','reading')",[`old-${i}`,u(4)])
  const capacity=await Promise.allSettled([
    a.query("insert into readings(id,user_id,title,reading_status) values('new-a',$1,'A','reading')",[u(4)]),
    b.query("insert into readings(id,user_id,title,reading_status) values('new-b',$1,'B','reading')",[u(4)]),
  ])
  assert.equal(capacity.filter(r=>r.status==='fulfilled').length,1)
  assert.equal((await admin.query("select count(*)::int n from readings where user_id=$1 and reading_status='reading'",[u(4)])).rows[0].n,5)
  // Independent accounts choose concurrently; recommendation count must reflect distinct users.
  await identity(a,5); await identity(b,6)
  await Promise.all([choose(a,'a'),choose(b,'a')])
  const counts=(await admin.query("select s.add_count,(select count(distinct user_id)::int from readings where share_source_id=s.id and deleted_at is null) actual from recommendation_submissions s where id='a'")).rows[0]
  assert.equal(counts.add_count,counts.actual)
  console.log('PASS: 5 native PostgreSQL multi-connection scenarios: A/B race, import/choose, dismiss/choose, capacity, distinct-user count.')
} finally {
  await Promise.allSettled(clients.map(c=>c.end()))
  if(started) await run(pg_ctl,['-D',dir,'-m','fast','-w','stop'])
}
