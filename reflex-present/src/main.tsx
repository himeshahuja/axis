import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SpatialDebug } from './spatial/ui/SpatialDebug.tsx'
import { SpatialTest } from './spatial/ui/SpatialTest.tsx'

const path = window.location.pathname.replace(/\/+$/, '')
const Page = path === '/spatial-test' ? SpatialTest : path === '/spatial-debug' ? SpatialDebug : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
