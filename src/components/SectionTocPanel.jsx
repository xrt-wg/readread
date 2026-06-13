import { X } from 'lucide-react'

/**
 * 从平铺 sections 构建 TOC 树。
 */
function buildTocTree(sections) {
  const roots = []
  const stack = []
  for (const section of sections) {
    const node = { section, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].section.depth >= section.depth) {
      stack.pop()
    }
    if (stack.length === 0) {
      roots.push(node)
    } else {
      stack[stack.length - 1].children.push(node)
    }
    stack.push(node)
  }
  return roots
}

function TocNodeItem({ node, depth, currentIdx, onSelect }) {
  const { section, children } = node
  const isActive = section.order === currentIdx
  return (
    <div>
      <button
        onClick={() => onSelect(section.order)}
        style={{
          display: 'block', width: '100%', textAlign: 'left',
          padding: `6px 12px 6px ${12 + depth * 16}px`,
          fontSize: '13px', fontFamily: 'DM Sans',
          fontWeight: isActive ? 600 : 400,
          color: isActive ? 'var(--ink)' : 'var(--ink-muted)',
          background: isActive ? 'rgba(196,154,60,0.1)' : 'transparent',
          border: 'none', borderRadius: '8px', cursor: 'pointer',
          lineHeight: 1.4,
        }}
      >
        {section.heading || `(第 ${section.order + 1} 节)`}
      </button>
      {children.length > 0 && children.map((child, i) => (
        <TocNodeItem key={i} node={child} depth={depth + 1} currentIdx={currentIdx} onSelect={onSelect} />
      ))}
    </div>
  )
}

export default function SectionTocPanel({ open, sections, currentIdx, onSelect, onClose }) {
  if (!open) return null
  const tree = buildTocTree(sections)

  return (
    <>
      <div
        className="fixed inset-0 z-30"
        style={{ background: 'rgba(28,25,23,0.15)' }}
        onClick={onClose}
      />
      <div
        className="fixed top-0 right-0 h-full z-40 flex flex-col"
        style={{
          width: '280px',
          background: '#fdfaf5',
          borderLeft: '1px solid rgba(28,25,23,0.09)',
          boxShadow: '-8px 0 32px rgba(28,25,23,0.1)',
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid rgba(28,25,23,0.08)' }}
        >
          <span style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '16px', fontWeight: 600, color: 'var(--ink)' }}>
            目录
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: '4px', borderRadius: '8px' }}
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {tree.map((node, i) => (
            <TocNodeItem key={i} node={node} depth={0} currentIdx={currentIdx} onSelect={(idx) => { onSelect(idx); onClose() }} />
          ))}
        </div>
      </div>
    </>
  )
}
