import { useState } from 'react'
import ImportPage from './components/ImportPage'
import ReaderPage from './components/ReaderPage'
import { articleStore, createArticle } from './store/storage'

export default function App() {
  const [article, setArticle] = useState(null)

  const handleImport = (text, title, markdown = null) => {
    const newArticle = createArticle({ text, title, markdown })
    articleStore.save(newArticle)
    setArticle(newArticle)
  }

  const handleOpen = (savedArticle) => {
    setArticle(savedArticle)
  }

  const handleBack = () => {
    setArticle(null)
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--parchment)' }}>
      {article ? (
        <ReaderPage article={article} onBack={handleBack} />
      ) : (
        <ImportPage onImport={handleImport} onOpen={handleOpen} />
      )}
    </div>
  )
}
