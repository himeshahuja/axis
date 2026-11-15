import { useEffect, useRef, useState } from 'react'
import { SCENES } from './scenes'
import { openChannel, type StageCommand, type StageStatus } from './sync'

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Laptop-side console. It never runs the camera: the audience window owns the pitch. */
export function PresenterConsole() {
  const [st, setSt] = useState<StageStatus | null>(null)
  const [, tick] = useState(0)
  const ch = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    const c = openChannel()
    ch.current = c
    if (c) c.onmessage = (e: MessageEvent<StageStatus>) => e.data?.type === 'state' && setSt(e.data)
    const id = window.setInterval(() => tick((n) => n + 1), 250)
    return () => {
      window.clearInterval(id)
      c?.close()
    }
  }, [])

  const send = (c: StageCommand | { type: 'clearMemory' }) => ch.current?.postMessage(c)
  const run = (cmd: Exclude<StageCommand, { cmd: 'goto' }>['cmd']) => send({ type: 'cmd', cmd })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') run(e.shiftKey ? 'nextScene' : 'next')
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') run('previous')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const connected = st && Date.now() - st.sentAt < 1500
  const scene = SCENES[st?.sceneIndex ?? 0]
  const upcoming = SCENES[(st?.sceneIndex ?? 0) + 1]
  const late = st ? Date.now() - st.sentAt : 0
  const sceneMs = st ? st.stageNow - st.sceneEnteredAt + late : 0
  const totalMs = st && st.startedAt !== null ? st.stageNow - st.startedAt + late : 0
  const over = sceneMs > scene.targetSeconds * 1000

  return (
    <main className="pitch-console">
      <header>
        <strong>Presenter</strong>
        <span className={connected ? 'ok' : 'bad'}>{connected ? 'linked to the audience window' : 'waiting for /pitch in another window of this browser'}</span>
      </header>
      <section className="now">
        <span className="n">{scene.number}</span>
        <div>
          <small>Now · {scene.kicker}</small>
          <h1>{scene.title}</h1>
        </div>
        <div className="time">
          <b className={over ? 'over' : ''}>{mmss(sceneMs)}</b>
          <small>of {mmss(scene.targetSeconds * 1000)}</small>
          <small>total {mmss(totalMs)} / 2:59</small>
        </div>
      </section>
      <section className="cols">
        <div className="notes">
          <h2>Say</h2>
          {scene.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
          <h2>Do</h2>
          <ol>
            {scene.beats.map((b) => (
              <li key={b.id} className={st?.doneBeats.includes(b.id) ? 'done' : ''}>
                {b.step}
                {b.fallback && <i> (→ does it)</i>}
              </li>
            ))}
          </ol>
          <h2>Next</h2>
          <p className="up">{upcoming ? `${upcoming.number} ${upcoming.title}` : 'End of the pitch'}</p>
        </div>
        <div className="side">
          <div className="status">
            <span>Camera</span>
            <b className={st?.camera === 'running' ? 'ok' : 'bad'}>{st?.camera ?? '—'}</b>
            <span>Hand</span>
            <b className={st?.handTracked ? 'ok' : 'bad'}>{st?.handTracked ? 'tracked' : 'not in view'}</b>
            <span>Gestures</span>
            <b className={st?.gesturesEnabled ? 'ok' : 'bad'}>{st ? (st.gesturesEnabled ? `on · ${st.gestureMode}` : 'paused') : '—'}</b>
            <span>Vexo band</span>
            <b>{st?.band ?? '—'}</b>
            <span>Actions menu</span>
            <b>{st?.radialStatus ?? '—'}</b>
            <span>Memory</span>
            <b>{st ? `${st.memoryCount} saved` : '—'}</b>
            <span>Audience view</span>
            <b>{st?.mode ?? '—'}</b>
          </div>
          <div className="btns">
            <button onClick={() => run('previous')}>← Back</button>
            <button className="primary" onClick={() => run('next')}>
              Next →
            </button>
            <button onClick={() => run('nextScene')}>Skip scene</button>
            <button onClick={() => run('reset')}>Restart</button>
            <button onClick={() => run('resetLayout')}>Reset layout</button>
            <button onClick={() => run('openMenu')}>Open actions</button>
            <button onClick={() => run('toggleGestures')}>{st?.gesturesEnabled === false ? 'Resume gestures' : 'Pause gestures'}</button>
            <button onClick={() => run('camera')}>{st?.camera === 'running' ? 'Stop camera' : 'Reconnect camera'}</button>
            <button onClick={() => run('calibrate')}>Recalibrate</button>
            <button onClick={() => run('toggleMirror')}>{st?.mirrored === false ? 'Mirror camera' : 'Unmirror camera'}</button>
            <button onClick={() => run('recenter')}>Recenter</button>
            <button onClick={() => run('toggleMode')}>{st?.mode === 'rehearsal' ? 'Hide rehearsal' : 'Show rehearsal'}</button>
            <button
              onClick={() => {
                if (window.confirm(`Delete all ${st?.memoryCount ?? 0} saved memory entries? This cannot be undone.`)) send({ type: 'clearMemory' })
              }}
            >
              Clear memory…
            </button>
          </div>
          <ol className="scenes">
            {SCENES.map((s, i) => (
              <li key={s.id}>
                <button className={i === st?.sceneIndex ? 'on' : ''} onClick={() => send({ type: 'cmd', cmd: 'goto', index: i })}>
                  <span>{s.number}</span> {s.title} <em>{s.targetSeconds}s</em>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  )
}
