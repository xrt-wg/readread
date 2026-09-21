import { ExternalLink } from 'lucide-react'

/**
 * 文章内联媒体的共享渲染组件——编辑器预览与阅读页共用，避免样式 drift。
 *
 * ArticleFigure：图片 + 可选底部说明（alt 即说明）。
 *  - 居中、限高（CSS .article-figure img），加载失败自动隐藏
 *  - 点击在新标签页查看原图（限高场景下的查看通道）；外层已是链接时由调用方省略 onClick 交由链接导航
 *
 * ArticleLink：正文同色 + 基线对齐小图标的链接（与收藏高亮零冲突）。
 *  - title 展示目标 URL；新标签页打开；withIcon=false 时不追加图标（如图片链接）
 */
export function ArticleFigure({ src, alt, clickable = true }) {
  return (
    <span className="article-figure">
      <img
        src={src}
        alt={alt ?? ''}
        style={clickable ? undefined : { cursor: 'default' }}
        onError={(e) => { e.currentTarget.style.display = 'none' }}
        onClick={clickable ? (e) => { e.stopPropagation(); window.open(src, '_blank', 'noopener') } : undefined}
      />
      {alt ? <span className="article-figcaption">{alt}</span> : null}
    </span>
  )
}

export function ArticleLink({ href, withIcon = true, children }) {
  return (
    <a href={href} title={href} className="article-link" target="_blank" rel="noopener noreferrer">
      {children}
      {withIcon ? <ExternalLink size="0.75em" className="article-link-icon" /> : null}
    </a>
  )
}
