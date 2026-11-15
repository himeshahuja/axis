import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { currentRoute } from './base.ts'
import { SpatialDebug } from './spatial/ui/SpatialDebug.tsx'
import { SpatialTest } from './spatial/ui/SpatialTest.tsx'

// The product site loads on its own route only, so its styles never reach the app pages.
const SitePage = lazy(() => import('./site/SitePage.tsx').then((m) => ({ default: m.SitePage })))

// The presenter board (/) is lazy too, so its stylesheets stay on its own route.
const App = lazy(() => import('./App.tsx'))

// The pitch is its own route and bundle, so its styles never reach the other pages.
const PitchPage = lazy(() => import('./pitch/PitchPage.tsx').then((m) => ({ default: m.PitchPage })))

const path = currentRoute()
const Page = path === '/spatial-test' ? SpatialTest : path === '/spatial-debug' ? SpatialDebug : path === '/site' ? SitePage : path === '/pitch' ? PitchPage : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  </StrictMode>,
)
