import { Component } from 'react'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="min-h-screen flex items-center justify-center"
             style={{ backgroundColor: 'var(--parchment)' }}>
          <div className="max-w-md px-6 text-center"
               style={{ color: 'var(--ink-muted)', fontSize: '14px', fontFamily: 'DM Sans' }}>
            <p style={{ fontSize: '18px', color: 'var(--ink)', marginBottom: '8px',
                        fontFamily: '"Playfair Display", Georgia, serif' }}>
              页面出现错误
            </p>
            <p style={{ marginBottom: '20px' }}>请尝试刷新页面。如果问题持续存在，请联系支持。</p>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: 'var(--ink)', color: 'var(--on-ink)', border: 'none',
                padding: '10px 24px', borderRadius: '10px', cursor: 'pointer',
                fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500,
              }}
            >
              刷新页面
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
