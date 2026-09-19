import { fmtDay } from './reportModel'

// Milestone trend chart: one line per milestone, one point per report, plotted as DRIFT: days
// later (or earlier) than the date first reported. A flat line is a date that held; a line that
// keeps climbing is a date that slips a little every report, which no single report shows. Plotting
// drift rather than the dates themselves keeps a two-day slip visible on a six-month project.
// Needs three points (two saved reports and this one).
const INK = '#16202E', INK3 = '#7C8797', RULE = '#D9DEE6', ACCENT = '#2B50C8'
const DAY = 86400000
const MARKS = ['circle', 'square', 'triangle', 'diamond', 'cross']

function Mark({ kind, x, y, s, color }) {
  if (kind === 'square') return <rect x={x - s} y={y - s} width={s * 2} height={s * 2} fill={color} />
  if (kind === 'triangle') return <path d={`M${x} ${y - s * 1.2} L${x + s * 1.1} ${y + s} L${x - s * 1.1} ${y + s}Z`} fill={color} />
  if (kind === 'diamond') return <path d={`M${x} ${y - s * 1.3} L${x + s * 1.3} ${y} L${x} ${y + s * 1.3} L${x - s * 1.3} ${y}Z`} fill={color} />
  if (kind === 'cross') return <path d={`M${x - s} ${y - s} L${x + s} ${y + s} M${x + s} ${y - s} L${x - s} ${y + s}`} stroke={color} strokeWidth={s * 0.7} fill="none" />
  return <circle cx={x} cy={y} r={s} fill={color} />
}

export const TREND_MIN_POINTS = 3

export default function MilestoneTrend({ points, milestones, dense = false }) {
  if (!points || points.length < TREND_MIN_POINTS) return null
  const pts = points.slice(-8)
  const W = 1000, fs = dense ? 17 : 11, H = dense ? 200 : 150
  const L = fs * 4.6, R = dense ? 330 : 240, T = fs * 0.9, B = fs * 2.1
  const series = [
    { id: 'finish', title: 'Finish', values: pts.map(p => p.end), strong: true },
    ...(milestones || []).filter(m => m.state !== 'done').slice(0, 4).map(m => ({ id: m.id, title: m.title, values: pts.map(p => p.milestones?.[String(m.id)] || null) })),
  ].filter(s => s.values.filter(Boolean).length >= 2)
  if (!series.length) return null
  const day = (v) => Math.round(new Date(v).getTime() / DAY)
  series.forEach(s => { const first = s.values.find(Boolean); s.drift = s.values.map(v => (v ? day(v) - day(first) : null)) })
  const all = series.flatMap(s => s.drift.filter(v => v != null))
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all)
  if (hi - lo < 4) { hi += Math.ceil((4 - (hi - lo)) / 2); lo = Math.min(lo, hi - 4) }
  const X = (i) => L + (pts.length === 1 ? 0 : (i / (pts.length - 1)) * (W - L - R))
  const Y = (d) => T + (1 - (d - lo) / (hi - lo)) * (H - T - B)                          // later is higher
  const stepT = Math.max(1, Math.ceil((hi - lo) / 4))
  const ticks = []; for (let d = Math.ceil(lo / stepT) * stepT; d <= hi; d += stepT) ticks.push(d)
  const last = (arr) => [...arr].reverse().find(v => v != null)
  // Right-hand labels, nudged apart so they never overlap.
  const labels = series.map((s, i) => ({ i, y: Y(last(s.drift)) })).sort((a, b) => a.y - b.y)
  for (let k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < fs * 1.15) labels[k].y = labels[k - 1].y + fs * 1.15
  const labelY = Object.fromEntries(labels.map(l => [l.i, l.y]))

  return (
    <div className="sr-trendchart">
      <div className="sr-trend-t">Milestone trend · days later than first reported</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Milestone trend across ${pts.length} reports`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? INK3 : RULE} strokeWidth="1" />
            <text x={L - fs * 0.5} y={Y(t) + fs * 0.34} fontSize={fs * 0.86} fill={INK3} textAnchor="end">{t === 0 ? 'on plan' : `${t > 0 ? '+' : '−'}${Math.abs(t)}d`}</text>
          </g>))}
        {pts.map((p, i) => (
          <text key={i} x={X(i)} y={H - fs * 0.45} fontSize={fs * 0.86} fill={INK3} textAnchor="middle">{i === pts.length - 1 ? 'now' : fmtDay(p.as_of)}</text>))}
        {series.map((s, si) => {
          const color = s.strong ? ACCENT : INK
          const xy = s.drift.map((d, i) => (d != null ? [X(i), Y(d)] : null)).filter(Boolean)
          return (
            <g key={s.id} data-series={s.title}>
              <polyline points={xy.map(p => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={s.strong ? 2.2 : 1.3} strokeOpacity={s.strong ? 1 : 0.75} />
              {xy.map(([px, py], k) => <Mark key={k} kind={MARKS[si % MARKS.length]} x={px} y={py} s={fs * 0.3} color={color} />)}
              <text x={W - R + fs * 0.8} y={labelY[si] + fs * 0.34} fontSize={fs * 0.9} fill={color} fontWeight={s.strong ? 700 : 500}>
                {(s.title.length > 22 ? s.title.slice(0, 21) + '…' : s.title)} · {fmtDay(last(s.values))}{last(s.drift) ? ` (${last(s.drift) > 0 ? '+' : '−'}${Math.abs(last(s.drift))}d)` : ''}
              </text>
            </g>)
        })}
      </svg>
    </div>
  )
}
