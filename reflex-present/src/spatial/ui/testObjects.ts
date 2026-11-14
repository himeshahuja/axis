import type { SpatialObject } from '../types'

// Six visually distinct targets of varied size, so interaction quality can be
// judged on both easy (large) and hard (small, close-together) targets. Each
// carries real structured data so the radial actions work from values.
export const TEST_OBJECTS: SpatialObject[] = [
  {
    id: 'revenue',
    label: 'Quarterly Revenue',
    color: '#5b8dee',
    shape: 'card',
    x: 0.08,
    y: 0.14,
    w: 0.22,
    h: 0.26,
    content: { kind: 'chart', unit: '$k', series: [{ label: 'Q1', value: 120 }, { label: 'Q2', value: 150 }, { label: 'Q3', value: 180 }, { label: 'Q4', value: 210 }] },
  },
  {
    id: 'revenue_prev_year',
    label: 'Revenue (Prior Year)',
    color: '#5bf0a5',
    shape: 'card',
    x: 0.4,
    y: 0.14,
    w: 0.22,
    h: 0.26,
    content: { kind: 'chart', unit: '$k', series: [{ label: 'Q1', value: 90 }, { label: 'Q2', value: 100 }, { label: 'Q3', value: 125 }, { label: 'Q4', value: 160 }] },
  },
  { id: 'conversion', label: 'Conversion', color: '#ff7a59', shape: 'circle', x: 0.74, y: 0.14, w: 0.11, h: 0.2, content: { kind: 'metric', value: 0.12, format: 'percent' } },
  { id: 'q3', label: 'Q3 Signups', color: '#ffd23f', shape: 'pill', x: 0.1, y: 0.62, w: 0.13, h: 0.09, content: { kind: 'metric', value: 1840, format: 'number' } },
  { id: 'q4', label: 'Q4 Signups', color: '#c77dff', shape: 'pill', x: 0.26, y: 0.62, w: 0.13, h: 0.09, content: { kind: 'metric', value: 2310, format: 'number' } },
  {
    id: 'notes',
    label: 'Launch Notes',
    color: '#e8e9ee',
    shape: 'card',
    x: 0.6,
    y: 0.58,
    w: 0.26,
    h: 0.24,
    content: { kind: 'note', text: 'Ship pricing page before Q1 close\nMove onboarding email to day 2\nRisk: support load after launch' },
  },
]
