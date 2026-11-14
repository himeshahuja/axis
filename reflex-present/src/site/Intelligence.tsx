// Section 5: one object, three outputs. Every output is computed here from the
// chart's own numbers by the app's modules; nothing is a canned model reply.

import { useMemo, useState } from 'react'
import { describeObject } from '../spatial/radial/actions/explain'
import { memoryEntryFor } from '../spatial/radial/actions/memory'
import { ACTION_LABEL, type RadialAction } from '../spatial/radial/types'
import { siteMemory, useMemories } from './memory'
import { byId, ObjectVisual, SITE_OBJECTS } from './objects'
import { ActionGlyph } from './RadialRing'
import { VoiceConsole } from './VoiceConsole'

const ORDER: RadialAction[] = ['explain', 'remember', 'voice']
const VERB: Record<RadialAction, string> = {
  explain: 'reads its own numbers back to you.',
  remember: 'becomes a card you can find later.',
  voice: 'stays in context while you talk.',
}

export function Intelligence() {
  const obj = byId('revenue')!
  const [mode, setMode] = useState<RadialAction>('explain')
  const facts = useMemo(() => describeObject(obj).facts, [obj])
  const entry = useMemo(() => memoryEntryFor(obj, SITE_OBJECTS), [obj])
  const memories = useMemories()
  const saved = memories.some((m) => m.objectId === obj.id)

  return (
    <section className={`intel mode-${mode}`} id="intelligence" aria-label="Objects become intelligence">
      <div className="intel-top">
        <div className="section-index mono">
          <span>[05]</span>
          <span>Objects become intelligence</span>
        </div>
        <p className="intel-sentence" data-reveal>
          The same chart <span className="hot">{VERB[mode]}</span>
        </p>
      </div>

      <div className="intel-body">
        <div className="intel-tabs" role="tablist" aria-label="Action">
          {ORDER.map((a, i) => (
            <button key={a} role="tab" aria-selected={mode === a} className={mode === a ? 'on' : ''} onClick={() => setMode(a)} onMouseEnter={() => setMode(a)}>
              <span className="mono">{String(i + 1).padStart(2, '0')}</span>
              {ACTION_LABEL[a]}
              <svg viewBox="-12 -12 24 24" aria-hidden="true">
                <ActionGlyph action={a} />
              </svg>
            </button>
          ))}
        </div>

        <div className="intel-stage">
          <div className="intel-chart">
            <div className="floater-head">
              <span>CHART · $k</span>
              <span>{obj.id}</span>
            </div>
            <div className="floater-body">
              <ObjectVisual visual="chart" obj={obj} />
            </div>
            <div className="floater-foot">{obj.label}</div>
          </div>

          <div className="intel-out" key={mode}>
            {mode === 'explain' && (
              <>
                <ol className="facts big">
                  {facts.map((f, i) => (
                    <li key={i} style={{ animationDelay: `${i * 80}ms` }}>
                      {f}
                    </li>
                  ))}
                </ol>
                <p className="provenance mono">Deterministic summary from the four data points, by describeObject(). Labelled as such in the product, too. An AI provider can plug in behind the same interface.</p>
              </>
            )}
            {mode === 'remember' && (
              <>
                <div className="memcard">
                  <div className="memcard-head mono">
                    <span>MEMORY</span>
                    <span>{entry.type}</span>
                  </div>
                  <b>{entry.title}</b>
                  <div className="memcard-spark">
                    <ObjectVisual visual="chart" obj={obj} />
                  </div>
                  <dl className="mono">
                    <dt>Points</dt>
                    <dd>{entry.content?.kind === 'chart' ? entry.content.series.map((s) => `${s.label} ${s.value}`).join(' · ') : '—'}</dd>
                    <dt>Seen with</dt>
                    <dd>{entry.canvas.neighbours.join(', ')}</dd>
                    <dt>Stored</dt>
                    <dd>{siteMemory.label}</dd>
                  </dl>
                </div>
                <button type="button" className="btn btn-primary" onClick={() => siteMemory.add(memoryEntryFor(obj, SITE_OBJECTS))}>
                  {saved ? 'Save another snapshot' : 'Remember this chart'}
                </button>
                <p className="provenance mono">{memories.length} in memory. Same collection as the playground tray. The Vexo band has no memory API, so nothing is written to it.</p>
              </>
            )}
            {mode === 'voice' && <VoiceConsole obj={obj} />}
          </div>
        </div>
      </div>
    </section>
  )
}
