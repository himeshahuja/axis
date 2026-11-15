// Contracts for the Reflex Actions radial menu. Time follows the spatial
// convention (`tMs` = performance.now() ms); device-clock times say so.

export type RadialAction = 'explain' | 'remember' | 'voice'

/** Counter-clockwise → clockwise: Voice (lower-left), Explain (top), Remember (lower-right). */
export const ACTION_ORDER: RadialAction[] = ['voice', 'explain', 'remember']

export const ACTION_LABEL: Record<RadialAction, string> = {
  explain: 'Explain',
  remember: 'Remember',
  voice: 'Voice',
}

/** Where a continuous rotation reading comes from. Only 'vexo' is the real band. */
export type RotationSourceKind = 'vexo' | 'camera' | 'simulator'

/** What last changed the highlighted action. */
export type SelectionSource = RotationSourceKind | 'keyboard' | 'wheel' | 'click' | 'none'

export interface RotationObservation {
  source: RotationSourceKind
  tMs: number
  /** Relative wrist angle since the menu's neutral reference, degrees; clockwise positive. */
  angleDegrees?: number
  /** Bias-corrected rate on the calibrated axis, degrees/second (the band reports deg/s). */
  angularVelocityDps?: number
  calibrated: boolean
  confidence?: number
}

export type RadialStatus =
  | 'IDLE'
  | 'OBJECT_SELECTED'
  | 'HOLDING'
  | 'MENU_OPEN'
  | 'ACTION_HIGHLIGHTED'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'TRACKING_LOST'
  | 'DEVICE_DISCONNECTED'

export interface RadialMenuState {
  status: RadialStatus
  /** Frozen when the menu opens; actions always apply to this object. */
  objectId: string | null
  activeAction: RadialAction
  /** Relative angle after sensitivity, inversion and smoothing. */
  rotationDegrees: number
  inputSource: SelectionSource
  /** 0..1 while HOLDING. */
  holdProgress: number
  openedAtMs: number | null
  /** The hand has moved off the open menu: letting go now cancels instead of running. */
  cancelArmed?: boolean
}

export interface RadialActionEvent {
  /** Unique per confirmation: the executor runs each id at most once. */
  id: number
  action: RadialAction
  objectId: string
  tMs: number
  selectionSource: SelectionSource
}

export const isMenuOpen = (s: RadialStatus) =>
  s === 'MENU_OPEN' || s === 'ACTION_HIGHLIGHTED' || s === 'CONFIRMING' || s === 'TRACKING_LOST' || s === 'DEVICE_DISCONNECTED'
