import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '../.tmp-first-reading-validation/node_modules/@electric-sql/pglite/dist/index.js'
import { fixtureSchema } from './first-reading-test-schema.mjs'
const db = new PGlite()
await db.exec(await fixtureSchema())
await db.exec(`create function is_current_user_admin() returns boolean language sql as $$select current_setting('test.admin',true)='yes'$$;
create table audit_logs(actor_user_id uuid,actor_role text,action text,target_type text,target_id text,payload jsonb);`)
for (const file of ['20260917000003_first_reading_offer.sql','20260917000004_first_reading_admin.sql']) await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'))
const uid='00000000-0000-0000-0000-000000000001'
await db.query('insert into auth.users values($1)',[uid]); await db.query('insert into profiles(user_id) values($1)',[uid])
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid])
await db.exec("set test.admin='no'; set role authenticated")
const get=async()=> (await db.query('select admin_get_first_reading_config() v')).rows[0].v
const save=async(a,b,enabled,stamp)=>(await db.query('select admin_save_first_reading_config($1,$2,$3,$4) v',[a,b,enabled,stamp])).rows[0].v
await assert.rejects(get,/无管理员权限/)
await assert.rejects(()=>save(null,null,false,null),/无管理员权限/)
await db.exec("reset role; set test.admin='yes'")
const sections=JSON.stringify([{depth:0,body:{text:'One two three'}}])
for(const id of ['a','b','c']) {
  await db.query("insert into recommendation_submissions(id,status,intro) values($1,'active','Introduction')",[id])
  await db.query("insert into recommendation_submission_snapshots(submission_id,title,sections) values($1,$1,$2)",[id,id==='c'?'[]':sections])
}
await db.exec('set role authenticated')
let config=await get()
assert.equal(config.enabled,false)
assert.equal(config.items.filter(i=>i.available).length,2)
await assert.rejects(()=>save('a','a',true,config.updatedAt),/不同/)
await assert.rejects(()=>save('a','c',true,config.updatedAt),/正文可用/)
await assert.rejects(()=>save('a',null,true,config.updatedAt),/两篇/)
const stale=config.updatedAt
config=await save('a','b',true,config.updatedAt)
assert.equal(config.enabled,true)
assert.equal(config.submissionA,'a')
await assert.rejects(()=>save(null,null,false,stale),/其他管理员/)
const offer=(await db.query('select get_first_reading_offer() v')).rows[0].v
assert.equal(offer.items.length,2)
await db.exec("reset role; update recommendation_submissions set status='removed' where id='a'; set role authenticated")
config=await get()
assert.equal(config.items.find(i=>i.id==='a').available,false)
config=await save('a','b',false,config.updatedAt)
assert.equal(config.enabled,false)
await db.exec('reset role')
assert.equal((await db.query('select count(*)::int n from audit_logs')).rows[0].n,2)
console.log('PASS: admin permissions, candidate health, duplicate/incomplete selection, enable, optimistic conflict, unavailable draft disable, audit, live offer.')
await db.close()
