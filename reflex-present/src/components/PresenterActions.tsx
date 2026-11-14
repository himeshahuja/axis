import { useState } from 'react'
import type { SpatialRuntime } from '../spatial/runtime'
import { isMenuOpen } from '../spatial/radial/types'
import { ExplainPanel, MemoryPanel, SavedToast, VoiceCapturePanel } from '../spatial/radial/ui/ActionPanels'
import { HoldRing, RadialActionMenu } from '../spatial/radial/ui/RadialActionMenu'
import '../spatial/radial/ui/radial.css'

/** His Explain / Remember / Voice actions, on the presenter's original stage. */
export function PresenterActions({ rt }: { rt: SpatialRuntime }) {
  const [memoryOpen, setMemoryOpen] = useState(false)
  const state = rt.radial.state
  const executor = rt.radial.executor
  const find = (id: string | null) => rt.interaction.objects.find((o) => o.id === id)
  const object = find(state.objectId)
  const voiceObject = find(executor.voice?.objectId ?? null)
  const recentSave = executor.lastSaved && Date.now() - new Date(executor.lastSaved.createdAt).getTime() < 2500
  return <div className="presenter-actions" onMouseDown={(e) => e.stopPropagation()}>
    {object && state.status === 'HOLDING' && <HoldRing object={object} canvas={rt.canvasPx} progress={state.holdProgress} color="#edca7c" />}
    {object && isMenuOpen(state.status) && <RadialActionMenu state={state} object={object} canvas={rt.canvasPx} thresholdDeg={rt.radial.controller.mapper.config.thresholdDeg} maxDeg={rt.radial.controller.mapper.config.maxDeg} closing={false} bandLost={state.status === 'DEVICE_DISCONNECTED'} bandPretend={rt.radial.band?.link === 'sim'} graspMode theme="presenter" onChoose={(a) => rt.radial.choose(a)} />}
    {[...executor.explainCards.values()].map((card) => {
      const target = find(card.objectId)
      return target ? <ExplainPanel key={card.objectId} card={card} object={target} compact onClose={() => executor.closeExplain(card.objectId)} /> : null
    })}
    {executor.voice && voiceObject && <VoiceCapturePanel session={executor.voice} object={voiceObject} objects={rt.interaction.objects} providers={rt.radial.voiceProviders} onClose={() => executor.closeVoice()} />}
    {recentSave && <SavedToast entry={executor.lastSaved!} />}
    {(memoryOpen || executor.memory.list().length > 0) && <MemoryPanel entries={executor.memory.list()} label={executor.memory.label} highlightId={recentSave ? executor.lastSaved!.id : null} open={memoryOpen} onToggle={() => setMemoryOpen((v) => !v)} />}
  </div>
}
