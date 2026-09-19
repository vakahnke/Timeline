import { useLayoutEffect, useRef, useState } from 'react'
import { fmtDay } from './reportModel'

// The simplified, printable timeline: one bar per track with a progress fill, the chosen
// milestones as diamonds labelled with their dates, the past shaded, a today line, and the
// critical path underlined. Pure SVG so it prints as vectors at any size (the app's interactive
// timeline is canvas, which prints as a bitmap).
//
// It is drawn in a fixed 1000-unit-wide coordinate system whose HEIGHT follows the aspect ratio of
// the box it sits in. The page scales everything proportionally (container-query units), so that
// ratio is the same on screen and on paper: printing is then a pure vector scale, with no need to
// re-measure at print time.
const W = 1000
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const INK = '#16202E', INK3 = '#7C8797', RULE = '#D9DEE6', ACCENT = '#2B50C8', WARN = '#B86E00', BAD = '#B3362B'

export default function ReportTimeline({ facts, rows, milestones, showCritical = true, showProgress = true, showBaseline = false, dense = false, read = false }) {
  const wrapRef = useRef(null)
  const [aspect, setAspect] = useState(dense ? 0.4 : 0.2)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setAspect(r.height / r.width) }
    measure()
    if (!window.ResizeObserver) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!facts || facts.empty || !rows.length) {
    return <div className="sr-tl" ref={wrapRef}><div className="sr-tl-empty">No events to draw yet.</div></div>
  }

  const H = Math.max(120, W * aspect)
  const fs = read ? 31 : dense ? 19 : 11.5          // text size in drawing units (read: a phone-width column)
  const L = read ? 262 : dense ? 172 : 118, R = fs * 1.2, top = fs * 3.1, legendH = fs * 2.2
  const rowH = (H - top - legendH) / rows.length
  const barH = Math.min(rowH * 0.42, fs * 1.7)
  const dia = fs * 0.58

  // Time scale: the project's span padded a little, snapped out to whole weeks.
  const DAY = 86400000
  // Baseline ghosts: drawn only where the plan moved by a day or more, so an on-plan chart stays clean.
  const ms = (iso) => new Date(iso).getTime()
  const moved = (a, b) => !!a && !!b && Math.abs(ms(a) - ms(b)) >= DAY
  const ghostRows = showBaseline && facts.baseline
    ? rows.map(r => (moved(r.baseline_start, r.start) || moved(r.baseline_end, r.end)) ? r : null) : rows.map(() => null)
  const ghostMs = (m) => showBaseline && facts.baseline && moved(m.baseline_end, m.date)
  const baseTimes = [...ghostRows.filter(Boolean).flatMap(r => [ms(r.baseline_start), ms(r.baseline_end)]),
    ...milestones.filter(ghostMs).map(m => ms(m.baseline_end))]
  const anyGhost = baseTimes.length > 0
  const t0 = Math.min(new Date(facts.start).getTime(), ...baseTimes) - 4 * DAY
  const t1 = Math.max(new Date(facts.end).getTime(), ...milestones.map(m => new Date(m.date).getTime()), ...baseTimes) + 7 * DAY
  const x = (t) => L + ((new Date(t).getTime() - t0) / (t1 - t0)) * (W - L - R)
  const today = new Date(facts.as_of).getTime()
  const bodyH = H - top - legendH

  // Month bands
  const bands = []
  const c = new Date(t0); c.setDate(1); c.setHours(0, 0, 0, 0)
  for (let i = 0; c.getTime() < t1 && i < 60; i++) {
    const a = Math.max(t0, c.getTime()); const n = new Date(c); n.setMonth(n.getMonth() + 1)
    const b = Math.min(t1, n.getTime())
    if (b > a) bands.push({ a, b, label: MONTHS[c.getMonth()], alt: i % 2 === 1 })
    c.setMonth(c.getMonth() + 1)
  }
  const monthsShown = bands.length
  const rowIndex = Object.fromEntries(rows.map((r, i) => [r.name, i]))

  // Milestone labels. Each tries four spots around its diamond (above/below x right/left) and
  // takes the first that stays inside the chart and clear of every label already placed; if none
  // is free it shortens to just the date and tries again. Milestones of a hidden track are not
  // drawn (they still appear in the handout's table).
  const charW = fs * 0.95 * 0.54
  // Seeded with what a label must never cover: each row's percent figure and every diamond
  // (as a bar-height box, so a diamond does not block its own label just above or below it).
  const placed = []
  rows.forEach((r, i) => {
    const cy = top + rowH * i + rowH / 2, xs = x(r.start), w = Math.max(2, x(r.end) - xs)
    const done = Math.max(0, Math.min(1, (r.progress || 0) / 100))
    if (showProgress && done > 0 && done < 1 && w * (1 - done) > fs * 3)
      placed.push({ x0: xs + w * done + fs * 0.4, x1: xs + w * done + fs * 3, y0: cy - fs * 0.6, y1: cy + fs * 0.6 })
  })
  milestones.forEach(m => {
    const row = rowIndex[m.category] ?? rowIndex.Other
    if (row == null) return
    const mx = x(m.date), cy = top + rowH * row + rowH / 2
    placed.push({ x0: mx - dia, x1: mx + dia, y0: cy - barH / 2, y1: cy + barH / 2 })
    if (ghostMs(m)) placed.push({ x0: x(m.baseline_end) - dia * 0.7, x1: x(m.baseline_end) + dia * 0.7, y0: cy - barH / 2, y1: cy + barH / 2 })
  })
  const ghostH = Math.max(2.5, Math.min(rowH * 0.13, fs * 0.42)), ghostGap = fs * 0.22
  // Baseline strips are thin outlines, not obstacles: a label may sit over one (it has a white halo).
  const clear = (b) => b.x0 >= L - fs && b.x1 <= W - 2 && b.y0 >= fs * 1.6 && b.y1 <= H - legendH + fs * 0.4 &&
    !placed.some(o => b.x0 < o.x1 + fs * 0.4 && b.x1 > o.x0 - fs * 0.4 && b.y0 < o.y1 && b.y1 > o.y0)
  const marks = milestones.filter(m => rowIndex[m.category] != null || rowIndex.Other != null).map(m => {
    const row = rowIndex[m.category] ?? rowIndex.Other
    const mx = x(m.date), cy = top + rowH * row + rowH / 2
    const maxT = read ? 14 : dense ? 26 : 34
    const title = m.title.length > maxT ? m.title.slice(0, maxT - 1) + '…' : m.title
    const yAbove = cy - barH / 2 - fs * 0.45, yBelow = cy + barH / 2 + fs * 1.5
    let chosen = null
    const short = m.title.length > 16 ? m.title.slice(0, 15) + '…' : m.title
    const slip = ghostMs(m) && m.slip_days ? ` (${m.slip_days > 0 ? '+' : '−'}${Math.abs(m.slip_days)}d)` : ''
    for (const text of [`${title} · ${fmtDay(m.date)}${slip}`, `${short} · ${fmtDay(m.date)}${slip}`, `${fmtDay(m.date)}${slip}`, fmtDay(m.date)]) {
      const w = text.length * charW
      // A label normally goes to the right of its diamond. When another milestone of the same row
      // sits within that label's reach, go left first, so the neighbour keeps a spot of its own.
      const crowded = milestones.some(o => o !== m && (rowIndex[o.category] ?? rowIndex.Other) === row && x(o.date) > mx && x(o.date) - mx < w + dia * 2 + fs)
      const spots = crowded ? [[yAbove, true], [yAbove, false], [yBelow, true], [yBelow, false]] : [[yAbove, false], [yAbove, true], [yBelow, false], [yBelow, true]]
      for (const [y, right] of spots) {
        const tx = right ? mx - dia - fs * 0.4 : mx + dia + fs * 0.4
        const box = { x0: right ? tx - w : tx, x1: right ? tx : tx + w, y0: y - fs * 0.9, y1: y + fs * 0.25 }
        if (clear(box)) { chosen = { text, tx, y, right, box }; break }
      }
      if (chosen) break
    }
    if (chosen) placed.push(chosen.box)
    return { ...m, mx, cy, label: chosen }
  })

  const diamond = (cx, cy, s) => `M${cx} ${cy - s} L${cx + s} ${cy} L${cx} ${cy + s} L${cx - s} ${cy}Z`
  const legend = [
    showCritical && { k: 'crit', t: read ? 'Critical' : 'Critical path' },
    { k: 'done', t: read ? 'Met' : 'Milestone met' },
    { k: 'up', t: read ? 'Ahead' : 'Milestone ahead' },
    { k: 'late', t: read ? 'Late' : 'Past due' },
    anyGhost && { k: 'base', t: 'Baseline' },
  ].filter(Boolean)
  const step = fs * (read ? 5.6 : 10.2)
  const lx0 = W - R - legend.length * step

  return (
    <div className="sr-tl" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
           aria-label={`Timeline from ${fmtDay(facts.start)} to ${fmtDay(facts.end)} with ${rows.length} tracks and ${milestones.length} milestones`}>
        {bands.map((b, i) => (
          <g key={i}>
            {b.alt && <rect x={x(b.a)} y={top} width={x(b.b) - x(b.a)} height={bodyH} fill="#F6F7FA" />}
            {(monthsShown <= 14 || i % 2 === 0) && (x(b.b) - x(b.a)) > fs * 2.4 &&
              <text x={x(b.a) + fs * 0.45} y={fs * 1.15} fontSize={fs * 0.92} fill={INK3} fontWeight="700" letterSpacing=".06em">{b.label}</text>}
            <line x1={x(b.a)} x2={x(b.a)} y1={top - fs * 0.5} y2={top} stroke={RULE} strokeWidth="1" />
          </g>
        ))}
        {today > t0 && <rect x={L} y={top} width={Math.min(x(today), W - R) - L} height={bodyH} fill={INK} fillOpacity=".045" />}
        <line x1={L} x2={W - R} y1={top} y2={top} stroke={RULE} strokeWidth="1" />

        {rows.map((r, i) => {
          const cy = top + rowH * i + rowH / 2, xs = x(r.start), xe = x(r.end), w = Math.max(2, xe - xs)
          const done = Math.max(0, Math.min(1, (r.progress || 0) / 100))
          return (
            <g key={r.name}>
              {i > 0 && <line x1="0" x2={W - R} y1={top + rowH * i} y2={top + rowH * i} stroke="#EDF0F4" strokeWidth="1" />}
              <rect x="0" y={cy - barH / 2} width={fs * 0.36} height={barH} fill={r.color} />
              <text x={fs * 0.95} y={cy + fs * 0.36} fontSize={fs * 1.06} fill={INK} fontWeight="600">{r.name.length > (read ? 13 : 17) ? r.name.slice(0, read ? 12 : 16) + '…' : r.name}</text>
              <rect x={xs} y={cy - barH / 2} width={w} height={barH} fill={r.color} fillOpacity=".2" rx="2" />
              {showProgress && done > 0 && <rect x={xs} y={cy - barH / 2} width={w * done} height={barH} fill={r.color} rx="2" />}
              <rect x={xs} y={cy - barH / 2} width={w} height={barH} fill="none" stroke={r.color} strokeWidth="1" rx="2" />
              {showProgress && done > 0 && done < 1 && w * (1 - done) > fs * 3 &&
                <text x={xs + w * done + fs * 0.4} y={cy + fs * 0.34} fontSize={fs * 0.9} fill={INK} fontWeight="700">{Math.round(done * 100)}%</text>}
              {ghostRows[i] && <rect x={x(r.baseline_start)} y={cy - barH / 2 - ghostGap - ghostH} width={Math.max(2, x(r.baseline_end) - x(r.baseline_start))} height={ghostH}
                                     fill="#fff" stroke={INK3} strokeWidth="1" data-ghost="row" />}
              {showCritical && (r.critical_spans || []).map(([a, b], k) => (
                <line key={k} x1={x(a)} x2={Math.max(x(a) + 2, x(b))} y1={cy + barH / 2 + fs * 0.34} y2={cy + barH / 2 + fs * 0.34} stroke={ACCENT} strokeWidth={Math.max(1.6, fs * 0.17)} />
              ))}
            </g>
          )
        })}

        {today > t0 && today < t1 && (
          <g>
            <line x1={x(today)} x2={x(today)} y1={top - 2} y2={H - legendH} stroke={BAD} strokeWidth="1.4" />
            <rect x={x(today) - fs * 2.1} y="0" width={fs * 4.2} height={fs * 1.5} fill={BAD} rx="2" />
            <text x={x(today)} y={fs * 1.08} fontSize={fs * 0.86} fill="#fff" fontWeight="700" textAnchor="middle">TODAY</text>
          </g>
        )}

        {marks.map(m => (
          <g key={m.id}>
            {ghostMs(m) && (
              <g data-ghost="milestone">
                <line x1={x(m.baseline_end)} x2={m.mx} y1={m.cy} y2={m.cy} stroke={INK3} strokeWidth="1" strokeDasharray={`${fs * 0.3} ${fs * 0.22}`} />
                <path d={diamond(x(m.baseline_end), m.cy, dia * 0.7)} fill="#fff" stroke={INK3} strokeWidth="1" />
              </g>)}
            <path d={diamond(m.mx, m.cy, dia)} fill={m.state === 'done' ? INK : m.state === 'late' ? BAD : '#fff'} stroke={m.state === 'upcoming' ? INK : '#fff'} strokeWidth="1.3" />
            {m.label && (
              <text x={m.label.tx} y={m.label.y} fontSize={fs * 0.95} fill={m.state === 'late' ? BAD : INK} fontWeight="600" textAnchor={m.label.right ? 'end' : 'start'}
                    stroke="#fff" strokeWidth={fs * 0.32} strokeLinejoin="round" paintOrder="stroke">{m.label.text}</text>
            )}
          </g>
        ))}

        {legend.map((it, i) => {
          const cx = lx0 + i * step, ly = H - fs * 0.5, my = ly - fs * 0.38
          return (
            <g key={it.k}>
              {it.k === 'crit' && <line x1={cx} x2={cx + fs * 1.6} y1={my} y2={my} stroke={ACCENT} strokeWidth="2" />}
              {it.k === 'base' && <rect x={cx} y={my - fs * 0.2} width={fs * 1.6} height={fs * 0.4} fill="#fff" stroke={INK3} strokeWidth="1" />}
              {it.k !== 'crit' && it.k !== 'base' && <path d={diamond(cx + fs * 0.7, my, fs * 0.46)} fill={it.k === 'done' ? INK : it.k === 'late' ? BAD : '#fff'} stroke={it.k === 'up' ? INK : '#fff'} strokeWidth="1.2" />}
              <text x={cx + fs * 2} y={ly} fontSize={fs * 0.86} fill={INK3}>{it.t}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
