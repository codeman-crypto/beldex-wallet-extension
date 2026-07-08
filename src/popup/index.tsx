import { createRoot } from 'react-dom/client'
import { App } from './App'

// full-screen tab mode (?tab=1) gets a wider layout
if (new URLSearchParams(location.search).has('tab')) {
  document.body.classList.add('tab-mode')
}

createRoot(document.getElementById('root')!).render(<App />)
