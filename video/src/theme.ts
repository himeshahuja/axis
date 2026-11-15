// Axis visual identity, copied from the product site (reflex-present/src/site/site.css,
// the `.site` token block) so the film and the website are the same brand.

export const C = {
  bg: '#080808',
  bg2: '#111111',
  panel: '#0c0c0c',
  card: 'rgba(17, 17, 17, 0.92)',
  ink: '#f2f0eb',
  mute: '#969696',
  dim: '#5a5a5a',
  line: 'rgba(242, 240, 235, 0.12)',
  line2: 'rgba(242, 240, 235, 0.22)',
  hot: '#ff5a1f',
  hotSoft: 'rgba(255, 90, 31, 0.14)',
} as const

export const F = {
  display: "'Gravitas One', Georgia, serif",
  sans: "'DM Sans', system-ui, -apple-system, sans-serif",
} as const

/** The site's `--ease: cubic-bezier(0.2, 0.7, 0.1, 1)`. */
export const EASE: [number, number, number, number] = [0.2, 0.7, 0.1, 1]

export const W = 1920
export const H = 1080
export const FPS = 30
/** Film length: 1640 frames = 54.67 s. */
export const DURATION = 1640

/** Product name, as in reflex-present/src/site/brand.ts. */
export const BRAND = 'AXIS'
