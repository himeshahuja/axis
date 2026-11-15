// The Axis mark ("Viewfinder"): a stepped bar A with an orange crossbar, framed by the four
// corners of a selection — the thing you point at. Drawn on a 92-unit square; the bars and
// corners take the text colour (currentColor), the crossbar is always the pitch's orange.

/** [x, y, width] of each white bar, on the 92-unit square. */
const BARS: [number, number, number][] = [
  [44.01, 17.52, 12.59],
  [39.38, 26.13, 13.25],
  [34.74, 34.74, 23.18],
  [30.1, 43.35, 14.57],
  [20.83, 60.57, 15.9],
  [56.6, 60.57, 14.57],
  [15.53, 69.18, 22.52],
  [53.95, 69.18, 22.52],
]
const CROSS: [number, number, number] = [25.47, 51.96, 41.07]
const BAR_H = 5.3
const CORNERS = [
  'M1.75 18 V1.75 H18',
  'M74 1.75 H90.25 V18',
  'M90.25 74 V90.25 H74',
  'M18 90.25 H1.75 V74',
]

export function AxisMark({ className = '', title = 'Axis' }: { className?: string; title?: string }) {
  return (
    <svg className={`axis-mark ${className}`} viewBox="0 0 92 92" role="img" aria-label={title}>
      <g className="corners" fill="none" stroke="currentColor" strokeWidth="3.5">
        {CORNERS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g className="bars" fill="currentColor">
        {BARS.map(([x, y, w], i) => (
          <rect key={i} x={x} y={y} width={w} height={BAR_H} rx={BAR_H / 2} />
        ))}
      </g>
      <rect className="cross" x={CROSS[0]} y={CROSS[1]} width={CROSS[2]} height={BAR_H} rx={BAR_H / 2} fill="#ff5a1f" />
    </svg>
  )
}

/** The same mark as a standalone SVG string (favicon), white on black. */
export const AXIS_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 104 104"><rect x="-6" y="-6" width="104" height="104" rx="18" fill="#0b0b0b"/><g fill="none" stroke="#f2f0eb" stroke-width="3.5">${CORNERS.map((d) => `<path d="${d}"/>`).join('')}</g><g fill="#f2f0eb">${BARS.map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="${BAR_H}" rx="${BAR_H / 2}"/>`).join('')}</g><rect x="${CROSS[0]}" y="${CROSS[1]}" width="${CROSS[2]}" height="${BAR_H}" rx="${BAR_H / 2}" fill="#ff5a1f"/></svg>`

