// The one place the product name lives. Change it here and the whole site follows.

import { at } from '../base'
export const BRAND_NAME = 'AXIS'

export const ROUTES = {
  /** The real camera + wearable spatial demo (projector view). */
  liveDemo: at('/spatial-test'),
  /** Laptop-side debug view for the live demo. */
  liveDebug: at('/spatial-debug'),
  /** The voice/typed presentation engine. */
  presenter: at('/'),
} as const

export const REPO_URL = 'https://github.com/himeshahuja/air-draw'
