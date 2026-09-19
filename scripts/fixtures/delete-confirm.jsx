// Browser layout regression fixture. Memory-only rows; no account or backend access.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ImportItemList from '../../src/components/ImportItemList'
import '../../src/index.css'

const params = new URLSearchParams(location.search)
const theme = params.get('theme') || 'day-d'
document.documentElement.dataset.theme = theme
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let deleteCalls = [], editCalls = 0
const rows = Array.from({ length: Number(params.get('count') || 2) }, (_, i) => ({
  id: `fixture-${i}`, title: `Diagnostic article ${i + 1}`, createdAt: '2026-09-19',
  readingStatus: params.get('status') || 'unread', kind: 'article', totalWordCount: 100,
}))

function Shelf() {
  const [items, setItems] = useState(rows)
  const [mounted, setMounted] = useState(true)
  return <div className="canvas"><div className="tablet" style={{ maxWidth: '100%' }}>
    <div className="h-full flex flex-col">
      <header style={{ padding: 16 }}>虚拟书架 · {theme}<button onClick={() => setMounted(false)}>卸载列表</button></header>
      <main className="flex-1 flex flex-col items-center px-4" style={{ overflowY: 'auto', paddingTop: 20, paddingBottom: 24 }}>
        <div className="w-full animate-fade-up" style={{ maxWidth: 640 }}>
          <div style={{ height: 46 }}>未读 / 未读完 / 已读完 / 全部</div>
          {mounted && <ImportItemList items={items} activeFilter={params.get('filter') || 'all'} onEdit={() => editCalls++}
            onDelete={item => { deleteCalls.push(item.id); setItems(list => list.filter(row => row.id !== item.id)) }}
            onReset={() => {}} onMoveToReading={() => {}} />}
        </div>
      </main>
      <footer style={{ padding: 16 }}>仅内存数据 · 不连接数据库</footer>
    </div>
  </div></div>
}

async function runCase() {
  const checks = []
  function check(condition, name) { checks.push({ name, pass: !!condition }); if (!condition) throw new Error(name) }
  const findButton = (text, scope = document) => [...scope.querySelectorAll('button')].find(button => button.textContent.trim() === text)
  const dialog = () => document.querySelector('[role="dialog"]')
  async function open() {
    document.querySelector('button[title="更多"]').click()
    await pause(30)
    findButton('删除').click()
    await pause(40)
    check(!!dialog(), '确认框已打开')
  }
  function hit(button) {
    const r = button.getBoundingClientRect()
    return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
  }
  function restored() {
    check(!document.getElementById('root').inert && document.body.style.overflow === '', '背景 inert 和滚动锁恢复')
  }
  let measurement
  try {
    await pause(params.has('early') ? 40 : 650)
    const main = document.querySelector('main')
    if (params.has('scrolled')) main.scrollTop = main.scrollHeight
    await open()
    const overlay = dialog().parentElement
    const r = overlay.getBoundingClientRect()
    measurement = { viewport: [innerWidth, innerHeight], overlay: [r.x, r.y, r.width, r.height] }
    check(overlay.parentElement === document.body, 'Portal 直属 body')
    check(Math.abs(r.x) < 1 && Math.abs(r.y) < 1 && Math.abs(r.width - innerWidth) < 1 && Math.abs(r.height - innerHeight) < 1, '遮罩覆盖当前视口')
    check(document.getElementById('root').inert && document.body.style.overflow === 'hidden', '背景不可操作且锁住 body 滚动')
    check(document.activeElement === findButton('取消', dialog()), '初始焦点位于取消')
    check(dialog().getBoundingClientRect().top >= 0, '超高时顶部仍可达')
    const confirm = findButton('确认删除', dialog())
    overlay.scrollTop = overlay.scrollHeight
    await pause(20)
    check(hit(confirm), '滚动后确认按钮可命中')
    overlay.scrollTop = 0
    check(document.documentElement.scrollWidth <= innerWidth + 1, '页面无横向溢出')
    dialog().click(); await pause(20)
    check(!!dialog() && editCalls === 0, '弹窗内部点击不关闭、不触发编辑')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    check(document.activeElement === confirm, 'Shift+Tab 从取消循环到确认')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    check(document.activeElement === findButton('取消', dialog()), 'Tab 从确认循环到取消')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await pause(30)
    check(!dialog() && deleteCalls.length === 0, 'Escape 不删除')
    restored()
    check(document.activeElement?.title === '更多', '取消后恢复更多按钮焦点')
    await open(); findButton('取消', dialog()).click(); await pause(30)
    check(!dialog() && deleteCalls.length === 0, '取消不删除'); restored()
    await open(); dialog().parentElement.click(); await pause(30)
    check(!dialog() && deleteCalls.length === 0, '背景点击不删除'); restored()
    await open(); findButton('确认删除', dialog()).click(); await pause(30)
    check(!dialog() && deleteCalls.length === 1 && deleteCalls[0] === 'fixture-0', '确认仅调用一次且目标正确'); restored()
    check(document.activeElement === main, '确认后焦点落到仍存在的书架区域')
    if (rows.length > 1) {
      await open(); findButton('卸载列表').click(); await pause(30)
      check(!dialog(), '组件卸载清除 Portal'); restored()
    }
    parent.postMessage({ fixture: 'delete-confirm', pass: true, checks, measurement, query: location.search }, location.origin)
  } catch (error) {
    parent.postMessage({ fixture: 'delete-confirm', pass: false, error: error.message, checks, measurement, query: location.search }, location.origin)
  }
}

function Runner() {
  const [results, setResults] = useState([])
  const [running, setRunning] = useState(false)
  async function run() {
    setRunning(true); setResults([])
    const cases = []
    for (const [w, h] of [[1280, 720], [720, 600], [375, 667], [375, 300], [375, 180]]) {
      for (const theme of ['day-d', 'day-b', 'night']) cases.push({ w, h, theme, count: 2 })
    }
    cases.push({ w: 1280, h: 720, count: 1, filter: 'unread' },
      { w: 720, h: 600, count: 20, status: 'in_progress', filter: 'in_progress', scrolled: 1 },
      { w: 375, h: 300, count: 2, status: 'completed', filter: 'completed' },
      { w: 1280, h: 720, count: 2, early: 1 })
    for (const test of cases) {
      const frame = document.createElement('iframe')
      frame.title = `验收 ${test.w}×${test.h}`
      frame.style.cssText = `width:${test.w}px;height:${test.h}px;border:0;display:block`
      const result = await new Promise(resolve => {
        const timeout = setTimeout(() => { window.removeEventListener('message', receive); resolve({ pass: false, error: 'case timeout' }) }, 15000)
        function receive(event) {
          if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.fixture !== 'delete-confirm') return
          clearTimeout(timeout); window.removeEventListener('message', receive); resolve(event.data)
        }
        window.addEventListener('message', receive)
        frame.src = `?child=1&auto=1&${new URLSearchParams(test)}`
        document.querySelector('#test-frame').appendChild(frame)
      })
      setResults(old => [...old, { ...test, ...result }])
      frame.remove()
    }
    setRunning(false)
  }
  return <main style={{ padding: 24 }}><h1>删除确认浏览器回归验收</h1>
    <p>真实组件，内存数据，StrictMode；iframe 使用指定 CSS 视口。</p>
    <button disabled={running} onClick={run}>运行回归矩阵</button>
    <p role="status">{running ? '运行中' : '已就绪'} · {results.filter(r => r.pass).length}/{results.length} 通过</p>
    <pre id="results" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(results, null, 2)}</pre><div id="test-frame" /></main>
}
createRoot(document.getElementById('root')).render(<React.StrictMode>{params.has('child') ? <Shelf /> : <Runner />}</React.StrictMode>)
if (params.has('auto')) runCase()
