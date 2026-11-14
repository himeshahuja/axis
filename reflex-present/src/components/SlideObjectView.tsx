import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SlideObject } from '../types'

export function SlideObjectView({ obj, highlighted }: { obj: SlideObject; highlighted: boolean }) {
  const style: React.CSSProperties = {
    position: 'absolute',
    left: obj.x,
    top: obj.y,
    width: obj.w,
    height: obj.h,
    border: highlighted ? '3px solid #ff5a36' : '1px solid #3a3f4b',
    borderRadius: 10,
    background: '#1b1e27',
    boxShadow: highlighted ? '0 0 24px rgba(255,90,54,0.45)' : '0 1px 4px rgba(0,0,0,0.3)',
    transition: 'all 220ms ease',
    padding: 10,
    boxSizing: 'border-box',
    color: '#e8e9ee',
  }

  if (obj.type === 'metric') {
    const display = obj.format === 'percent' ? `${(obj.value * 100).toFixed(1)}%` : obj.value.toLocaleString()
    return (
      <div style={style}>
        <div style={{ fontSize: 13, opacity: 0.7 }}>{obj.title}</div>
        <div style={{ fontSize: 34, fontWeight: 700, marginTop: 8 }}>{display}</div>
      </div>
    )
  }

  return (
    <div style={style}>
      <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 4 }}>{obj.title}</div>
      <ResponsiveContainer width="100%" height="88%">
        <BarChart data={obj.series}>
          <CartesianGrid strokeDasharray="3 3" stroke="#30333d" />
          <XAxis dataKey="label" stroke="#8a8f9c" fontSize={12} />
          <YAxis stroke="#8a8f9c" fontSize={12} />
          <Tooltip contentStyle={{ background: '#11131a', border: '1px solid #3a3f4b' }} />
          <Bar dataKey="value" fill={highlighted ? '#ff5a36' : '#5b8dee'} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
