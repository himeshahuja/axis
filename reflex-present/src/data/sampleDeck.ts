import type { Slide } from '../types'

// Real structured data (not placeholder strings) so comparisons and scenario
// transforms compute from actual numbers, per the "no fake metrics" rule.
export const sampleSlide: Slide = {
  id: 'growth',
  title: 'Quarterly Growth',
  objects: [
    {
      id: 'revenue_chart',
      type: 'chart',
      title: 'Quarterly Revenue',
      x: 60,
      y: 120,
      w: 420,
      h: 280,
      series: [
        { label: 'Q1', value: 120 },
        { label: 'Q2', value: 150 },
        { label: 'Q3', value: 180 },
        { label: 'Q4', value: 210 },
      ],
    },
    {
      id: 'revenue_chart_prev_year',
      type: 'chart',
      title: 'Quarterly Revenue (Prior Year)',
      x: 540,
      y: 120,
      w: 420,
      h: 280,
      series: [
        { label: 'Q1', value: 90 },
        { label: 'Q2', value: 100 },
        { label: 'Q3', value: 125 },
        { label: 'Q4', value: 160 },
      ],
    },
    {
      id: 'conversion_metric',
      type: 'metric',
      title: 'Conversion Rate',
      x: 60,
      y: 440,
      w: 200,
      h: 120,
      value: 0.12,
      format: 'percent',
    },
  ],
}
