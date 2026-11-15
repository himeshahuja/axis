// The data the film shows, taken from the app so every number on screen is one the
// product really computes.
//   - Revenue series: reflex-present/src/site/objects.tsx (SITE_OBJECTS 'revenue').
//   - Explain facts: what describeObject() in
//     reflex-present/src/spatial/radial/actions/explain.ts returns for that series.
//   - Comparison: computeQuarterCompare() in .../actions/voiceCommand.ts.

export const REVENUE = [
  { label: 'Q1', value: 120 },
  { label: 'Q2', value: 150 },
  { label: 'Q3', value: 180 },
  { label: 'Q4', value: 210 },
] as const

export const EXPLAIN_FACTS = [
  '4 points, Q1 to Q4.',
  'From 120 $k to 210 $k: +90 $k (+75.0%).',
  'Rises at every step.',
  'Highest Q4 (210 $k), lowest Q1 (120 $k), average 165 $k.',
]

export const COMPARE_LINE = 'Q4 210 vs Q3 180: +30 (+16.7%)'

export const UTTERANCE = 'Compare this with last quarter.'
