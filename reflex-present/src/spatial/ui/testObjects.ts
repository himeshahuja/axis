import type { SpatialObject } from '../types'

// Six visually distinct targets of varied size, so interaction quality can
// be judged on both easy (large) and hard (small, close-together) targets.
export const TEST_OBJECTS: SpatialObject[] = [
  { id: 'revenue', label: 'Revenue', color: '#5b8dee', shape: 'card', x: 0.08, y: 0.14, w: 0.2, h: 0.22 },
  { id: 'growth', label: 'Growth', color: '#5bf0a5', shape: 'card', x: 0.4, y: 0.14, w: 0.2, h: 0.22 },
  { id: 'risk', label: 'Risk', color: '#ff5a36', shape: 'circle', x: 0.74, y: 0.14, w: 0.11, h: 0.2 },
  { id: 'q3', label: 'Q3', color: '#ffd23f', shape: 'pill', x: 0.1, y: 0.62, w: 0.12, h: 0.09 },
  { id: 'q4', label: 'Q4', color: '#c77dff', shape: 'pill', x: 0.25, y: 0.62, w: 0.12, h: 0.09 },
  { id: 'notes', label: 'Notes', color: '#e8e9ee', shape: 'card', x: 0.6, y: 0.58, w: 0.26, h: 0.24 },
]
