/**
 * 选区诊断探针（问题 12：划选选区过扩 / 「选区粘黏」）
 *
 * 目的：直接观测「拖选途中锚点是否因 DOM 变更被移除、并跳变到何处」。
 * 性质：纯只读诊断——只记录日志，不改变任何现有行为、不拦截任何事件。
 *
 * 使用：
 *   Ctrl+Shift+L  开始记录（屏幕左上角出现 ● REC 标记）
 *   复现问题（一次或多次划选）
 *   Ctrl+Shift+L  停止并自动下载 JSON 日志（同时打印在 Console，前缀 [probe]）
 *
 * 判据（发作的那次拖选）：
 *   - 拖选途中（duringDrag=true）锚点段落出现 mut 记录，且随后的 sel 记录中
 *     锚点节点 isConnected=false 或锚点身份跳变 → 「DOM 变更移除锚点」实锤；
 *   - 发作但全程无 mut 记录 → 推翻 DOM 变更说，转浏览器原生行为方向。
 */

const probe = {
  active: false,
  initialized: false,
  logs: [],
  t0: 0,
  isDown: false,
  observer: null,
  badge: null,
}

function now() {
  return Math.round(performance.now() - probe.t0)
}

/** 节点身份描述：类型 / 文本片段 / 所属段落 / 所属收藏 / 是否在文档中 */
function describeNode(node) {
  if (!node) return null
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
  const para = el?.closest?.('[data-para-index]')
  const bm = el?.closest?.('[data-bookmark-id]')
  return {
    kind: node.nodeType === Node.TEXT_NODE ? 'text' : String(node.nodeName).toLowerCase(),
    text: (node.textContent || '').replace(/\s+/g, ' ').slice(0, 40),
    para: para?.dataset?.paraIndex ?? null,
    bm: bm?.dataset?.bookmarkId ?? null,
    connected: node.isConnected,
  }
}

function log(type, data) {
  const entry = { t: now(), type, ...data }
  probe.logs.push(entry)
  // 保持 Console 可读：对象原地打印
  console.log('[probe]', type, entry)
}

function onSelectionChange() {
  if (!probe.active) return
  const sel = window.getSelection()
  if (!sel) return
  log('sel', {
    drag: probe.isDown,
    collapsed: sel.isCollapsed,
    len: sel.toString().length,
    anchor: describeNode(sel.anchorNode),
    aOff: sel.anchorOffset,
    focus: describeNode(sel.focusNode),
    fOff: sel.focusOffset,
  })
}

function onMouseDown(e) {
  if (!probe.active) return
  probe.isDown = true
  log('down', { x: e.clientX, y: e.clientY, detail: e.detail, target: describeNode(e.target) })
}

function onMouseUp(e) {
  if (!probe.active) return
  probe.isDown = false
  const sel = window.getSelection()
  log('up', {
    x: e.clientX,
    y: e.clientY,
    detail: e.detail,
    len: sel ? sel.toString().length : 0,
    head: sel ? sel.toString().slice(0, 30) : '',
  })
}

function summarizeNodeList(nodeList) {
  return [...nodeList].map((n) => ({
    kind: n.nodeType === Node.TEXT_NODE ? 'text' : String(n.nodeName).toLowerCase(),
    text: (n.textContent || '').replace(/\s+/g, ' ').slice(0, 40),
  }))
}

function onMutations(mutations) {
  if (!probe.active) return
  for (const m of mutations) {
    const target = m.target
    if (target?.closest?.('[data-selection-probe]')) continue // 忽略探针自身
    const para = target?.closest?.('[data-para-index]')
    const popup = target?.closest?.('[data-popup]')
    const zone = para ? 'paragraph' : popup ? 'popup' : 'other'
    // 只记录与正文/弹窗相关的变更，过滤头部等无关区域噪声
    if (zone === 'other' && m.type === 'characterData') continue
    if (zone === 'other' && m.type === 'childList') {
      const hit = [...m.addedNodes, ...m.removedNodes].some(
        (n) => n.nodeType === Node.ELEMENT_NODE && n.querySelector?.('[data-para-index],[data-popup]')
      )
      if (!hit) continue
    }
    log('mut', {
      drag: probe.isDown,
      zone,
      para: para?.dataset?.paraIndex ?? null,
      kind: m.type,
      target: String(target?.nodeName ?? '').toLowerCase(),
      added: m.type === 'childList' ? summarizeNodeList(m.addedNodes) : undefined,
      removed: m.type === 'childList' ? summarizeNodeList(m.removedNodes) : undefined,
      oldText:
        m.type === 'characterData'
          ? (m.oldValue || '').replace(/\s+/g, ' ').slice(0, 40)
          : undefined,
    })
  }
}

function showBadge() {
  const el = document.createElement('div')
  el.dataset.selectionProbe = 'true'
  el.textContent = '● REC 选区探针'
  Object.assign(el.style, {
    position: 'fixed',
    top: '8px',
    left: '8px',
    zIndex: 99999,
    padding: '4px 10px',
    background: 'rgba(220,38,38,0.92)',
    color: '#fff',
    fontSize: '12px',
    fontFamily: 'monospace',
    borderRadius: '4px',
    pointerEvents: 'none',
  })
  document.body.appendChild(el)
  probe.badge = el
}

function hideBadge() {
  probe.badge?.remove()
  probe.badge = null
}

function downloadLog() {
  const payload = {
    startedAt: new Date(probe.sessionStartWall).toISOString(),
    stoppedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    url: location.href,
    entries: probe.logs,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `selection-probe-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

function start() {
  probe.active = true
  probe.t0 = performance.now()
  probe.sessionStartWall = Date.now()
  probe.logs = []
  probe.isDown = false
  probe.observer = new MutationObserver(onMutations)
  probe.observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    characterDataOldValue: true,
  })
  document.addEventListener('selectionchange', onSelectionChange)
  // capture 阶段记录，保证先于应用自身处理器看到事件（只读，不干预）
  document.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('mouseup', onMouseUp, true)
  showBadge()
  log('session-start', { ua: navigator.userAgent })
}

function stop() {
  probe.active = false
  probe.observer?.disconnect()
  probe.observer = null
  document.removeEventListener('selectionchange', onSelectionChange)
  document.removeEventListener('mousedown', onMouseDown, true)
  document.removeEventListener('mouseup', onMouseUp, true)
  hideBadge()
  log('session-stop', {})
  downloadLog()
  console.log('[probe] 已停止，日志条目数：', probe.logs.length)
}

function onKeyDown(e) {
  if (!(e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l'))) return
  e.preventDefault()
  if (probe.active) stop()
  else start()
}

/** 幂等初始化：挂快捷键。在 ReaderPage 挂载时调用一次即可。 */
export function initSelectionProbe() {
  if (probe.initialized) return
  probe.initialized = true
  document.addEventListener('keydown', onKeyDown)
  window.__selectionProbe = probe // Console 兜底导出：__selectionProbe.logs
}
