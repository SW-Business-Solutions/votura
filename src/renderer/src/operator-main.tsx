import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './operator/App'
import { AppStateProvider } from './operator/state'
import './styles/app.css'
import './styles/projection.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </StrictMode>
)
