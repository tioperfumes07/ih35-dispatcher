import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/table-resize.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found. Check index.html for <div id="root">')
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary name="App">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
