// Product demo website, mounted at /site. Isolated from the app: its own styles
// under .site, its own route, no changes to the spatial engine.

import { useEffect } from 'react'
import { BRAND_NAME, REPO_URL, ROUTES } from './brand'
import { Disappear } from './Disappear'
import { FieldCanvas } from './FieldCanvas'
import { Hero } from './Hero'
import { Intelligence } from './Intelligence'
import { installPointer } from './motion'
import { Orientation } from './Orientation'
import { Playground } from './Playground'
import { System } from './System'
import './site.css'

function Nav() {
  return (
    <nav className="nav" aria-label="Primary">
      <a href="#top" className="nav-brand">
        <span className="nav-mark" aria-hidden="true" />
        {BRAND_NAME}
      </a>
      <div className="nav-links mono">
        <a href="#shift">Shift</a>
        <a href="#playground">Playground</a>
        <a href="#actions">Actions</a>
        <a href="#system">System</a>
      </div>
      <a href={ROUTES.liveDemo} className="nav-cta mono">
        Live demo ↗
      </a>
    </nav>
  )
}

function Launch() {
  return (
    <section className="launch" id="launch" aria-label="Launch the live demo">
      <FieldCanvas className="launch-field" spacing={34} radius={300} />
      <div className="launch-inner">
        <div className="section-index mono">
          <span>[07]</span>
          <span>Live demo</span>
        </div>
        <h2 className="launch-title" data-reveal>
          The interface
          <br />
          is <span className="hot">yours.</span>
        </h2>
        <div className="launch-row">
          <a className="btn btn-primary btn-xl" href={ROUTES.liveDemo}>
            Launch interactive demo <span aria-hidden="true">↗</span>
          </a>
          <div className="launch-notes mono">
            <p>Camera + optional Vexo band. Hand tracking runs on this machine; the model is bundled, so no network needed once loaded.</p>
            <p>
              <a href={ROUTES.liveDebug}>Debug view {ROUTES.liveDebug}</a> · <a href={ROUTES.presenter}>Voice presenter {ROUTES.presenter}</a>
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer mono">
      <span className="footer-brand">{BRAND_NAME}</span>
      <span>VexoHacks 2026</span>
      <span>Built on the Air Draw repository</span>
      <a href={REPO_URL} target="_blank" rel="noreferrer">
        GitHub ↗
      </a>
      <a href="#top">Top ↑</a>
    </footer>
  )
}

export function SitePage() {
  useEffect(() => {
    installPointer()
    document.documentElement.classList.add('site-root')
    document.title = `${BRAND_NAME} — Computing, without the interface`
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        }),
      { threshold: 0.2 },
    )
    document.querySelectorAll('[data-reveal]').forEach((n) => io.observe(n))
    return () => {
      io.disconnect()
      document.documentElement.classList.remove('site-root')
    }
  }, [])

  return (
    <div className="site">
      <a className="skip mono" href="#playground">
        Skip to the playground
      </a>
      <Nav />
      <main>
        <Hero />
        <Disappear />
        <Playground />
        <Orientation />
        <Intelligence />
        <System />
        <Launch />
      </main>
      <Footer />
    </div>
  )
}
