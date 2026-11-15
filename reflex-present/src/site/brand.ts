// The one place the product name lives. Change it here and the whole site follows.
export const BRAND_NAME = 'AXIS'

export const ROUTES = {
  /** The real camera + wearable spatial demo (projector view). */
  liveDemo: '/spatial-test',
  /** Laptop-side debug view for the live demo. */
  liveDebug: '/spatial-debug',
  /** The voice/typed presentation engine. */
  presenter: '/',
  /** The product site. */
  site: '/site',
  /** The interactive pitch. */
  pitch: '/pitch',
  /** The Vexo Board concept: a band that tracks a marker on any whiteboard. */
  board: '/board',
} as const

export const REPO_URL = 'https://github.com/himeshahuja/air-draw'
