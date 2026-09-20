import { useEffect, useMemo, useRef, useState } from 'react'

// A read-only drawing of a template's plan: tracks, bars, dependency lines and milestone
// diamonds, laid out on relative time ("Week 3"), because a template has no dates yet.

const DAY = 1440
const ROW = 22, GAP = 4, LABEL_W = 116, AXIS_H = 22, PAD = 8
const PAD_RIGHT = 18     // room for a milestone diamond on the very last event

function ticks(span) {
  const days = span / DAY
  const [unit, word] = days <= 21 ? [DAY, 'Day'] : days <= 200 ? [7 * DAY, 'Week'] : [30 * DAY, 'Month']
  const count = Math.ceil(span / unit)
  const every = Math.max(1, Math.ceil(count / 12))
  const out = []
  for (let i = 0; i <= count; i += every) out.push({ at: i * unit, label: `${word} ${i + 1}` })
  return out
}

// Events in one track that overlap in time are stacked on separate lines.
function lanes(tasks) {
  const ends = []
  return tasks.map(t => {
    let lane = ends.findIndex(end => end <= t.s)
    if (lane === -1) { lane = ends.length; ends.push(0) }
    ends[lane] = t.e
    return lane
  })
}

export default function TemplatePreview({ categories = [], tasks = [] }) {
  const wrap = useRef(null)
  const [width, setWidth] = useState(720)

  useEffect(() => {
    if (!wrap.current) return undefined
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(560, Math.floor(entry.contentRect.width))))
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(() => {
    const items = tasks.map((t, i) => ({
      i, title: t.title, category: t.category, milestone: !!t.is_milestone, deps: t.depends_on || [],
      s: t.start_offset_minutes || 0,
      e: (t.start_offset_minutes || 0) + Math.max(1, t.duration_minutes || 60),
    }))
    if (!items.length) return null
    const t0 = Math.min(...items.map(t => t.s))
    const span = Math.max(1, Math.max(...items.map(t => t.e)) - t0)
    const names = [...categories.map(c => c.name)]
    for (const t of items) if (!names.includes(t.category)) names.push(t.category)
    const color = Object.fromEntries(categories.map(c => [c.name, c.color]))

    const plotW = width - LABEL_W - PAD - PAD_RIGHT
    const x = m => LABEL_W + PAD + ((m - t0) / span) * plotW
    let y = AXIS_H
    const tracks = []
    const pos = {}
    for (const name of names) {
      const mine = items.filter(t => t.category === name).sort((a, b) => a.s - b.s)
      if (!mine.length) continue
      const lane = lanes(mine)
      const rows = Math.max(...lane) + 1
      mine.forEach((t, k) => {
        const x0 = x(t.s), w = Math.max(3, x(t.e) - x(t.s))
        pos[t.i] = { ...t, x: x0, w, y: y + GAP + lane[k] * (ROW + GAP), color: color[name] || '#818cf8' }
      })
      tracks.push({ name, y, h: rows * (ROW + GAP) + GAP, color: color[name] || '#818cf8' })
      y += rows * (ROW + GAP) + GAP
    }
    return { tracks, pos, height: y + PAD, x, t0, span }
  }, [categories, tasks, width])

  if (!layout) return <p className="dim">This template has no events yet.</p>
  const { tracks, pos, height, x, t0, span } = layout
  const bars = Object.values(pos)

  return (
    <div className="tl-preview" ref={wrap}>
      <svg width={width} height={height} role="img"
           aria-label={`Plan preview: ${bars.length} events in ${tracks.length} tracks`}>
        {ticks(span).map(t => (
          <g key={t.at}>
            <line x1={x(t0 + t.at)} x2={x(t0 + t.at)} y1={AXIS_H - 4} y2={height - PAD} className="tl-preview-grid" />
            {x(t0 + t.at) < width - 52 && <text x={x(t0 + t.at) + 3} y={12} className="tl-preview-tick">{t.label}</text>}
          </g>
        ))}
        {tracks.map((t, k) => (
          <g key={t.name}>
            {k % 2 === 0 && <rect x={0} y={t.y} width={width} height={t.h} className="tl-preview-band" />}
            <rect x={0} y={t.y + 3} width={3} height={t.h - 6} fill={t.color} rx={1.5} />
            <text x={10} y={t.y + GAP + ROW / 2 + 4} className="tl-preview-track">
              {t.name.length > 17 ? `${t.name.slice(0, 16)}…` : t.name}
            </text>
          </g>
        ))}
        {bars.flatMap(b => b.deps.filter(d => pos[d]).map(d => {
          const from = pos[d]
          const x1 = from.x + from.w, y1 = from.y + ROW / 2, x2 = b.x, y2 = b.y + ROW / 2
          const mid = Math.max(x1 + 6, (x1 + x2) / 2)
          return <path key={`${d}-${b.i}`} className="tl-preview-dep"
                       d={`M${x1},${y1} H${mid} V${y2} H${x2}`} />
        }))}
        {bars.map(b => (
          <g key={b.i}>
            <title>{b.title}</title>
            <rect x={b.x} y={b.y} width={b.w} height={ROW} rx={4} fill={b.color} fillOpacity={0.78} />
            {b.w > 46 && (
              <text x={b.x + 6} y={b.y + ROW / 2 + 4} className="tl-preview-label">
                {b.title.length * 6.2 > b.w - 10 ? `${b.title.slice(0, Math.max(3, Math.floor((b.w - 16) / 6.2)))}…` : b.title}
              </text>
            )}
            {b.milestone && (
              <path className="tl-preview-diamond"
                    d={`M${b.x + b.w},${b.y - 3} l7,${ROW / 2 + 3} l-7,${ROW / 2 + 3} l-7,-${ROW / 2 + 3} z`} />
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}
