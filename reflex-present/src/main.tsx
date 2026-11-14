import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SpatialDebug } from './spatial/ui/SpatialDebug.tsx'
import { SpatialTest } from './spatial/ui/SpatialTest.tsx'

// The product site loads on its own route only, so its styles never reach the app pages.
const SitePage = lazy(() => import('./site/SitePage.tsx').then((m) => ({ default: m.SitePage })))

const path = window.location.pathname.replace(/\/+$/, '')
const Page = path === '/spatial-test' ? SpatialTest : path === '/spatial-debug' ? SpatialDebug : path === '/site' ? SitePage : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  </StrictMode>,
)
