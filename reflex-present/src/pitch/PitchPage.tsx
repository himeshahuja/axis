import '../spatial/radial/ui/radial.css'
import './pitch.css'
import { PitchStage } from './PitchStage'
import { PresenterConsole } from './PresenterConsole'

/** /pitch = the audience stage; /pitch?view=presenter = the laptop console that drives it. */
export function PitchPage() {
  return new URLSearchParams(location.search).get('view') === 'presenter' ? <PresenterConsole /> : <PitchStage />
}
