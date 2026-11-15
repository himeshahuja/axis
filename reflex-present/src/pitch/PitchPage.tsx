import '../spatial/radial/ui/radial.css'
import './pitch.css'
import { useEffect } from 'react'
import { AXIS_MARK_SVG } from './AxisMark'
import { PitchStage } from './PitchStage'
import { PresenterConsole } from './PresenterConsole'

/** /pitch = the audience stage; /pitch?view=presenter = the laptop console that drives it. */
export function PitchPage() {
  // The tab shows the Axis mark and name, not the dev app's.
  useEffect(() => {
    const presenter = new URLSearchParams(location.search).get('view') === 'presenter'
    document.title = presenter ? 'Axis — presenter' : 'Axis'
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!icon) {
      icon = document.createElement('link')
      icon.rel = 'icon'
      document.head.append(icon)
    }
    icon.type = 'image/svg+xml'
    icon.href = `data:image/svg+xml,${encodeURIComponent(AXIS_MARK_SVG)}`
  }, [])
  return new URLSearchParams(location.search).get('view') === 'presenter' ? <PresenterConsole /> : <PitchStage />
}
