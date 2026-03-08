import { useRef, useEffect, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from 'react'
import { RULER_HEIGHT, TRACK_HEIGHT, TICK_INTERVALS, MIN_PX_PER_HR, MAX_PX_PER_HR } from '../constants'
import EventBlock from './EventBlock'

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

function fmtDateTime(ms) {
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    '  ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

function toLocalISO(date) {
  const off = date.getTimezoneOffset() * 60_000
  return new Date(date - off).toISOString().slice(0, 16)
}

function drawRuler(canvas, rangeStart, rangeEnd, pxPerHour, width) {
  const ctx  = canvas.getContext('2d')
  const h    = RULER_HEIGHT
  canvas.width  = width
  canvas.height = h

  ctx.fillStyle = '#0f1219'
  ctx.fillRect(0, 0, width, h)

  const pxPerMs  = pxPerHour / 3_600_000
  let interval   = TICK_INTERVALS[TICK_INTERVALS.length - 1]
  for (const iv of TICK_INTERVALS) {
    if (iv.ms * pxPerMs >= 56) { interval = iv; break }
  }

  const msToX    = ms => ((ms - rangeStart) / 3_600_000) * pxPerHour
  const first    = Math.ceil(rangeStart / interval.ms) * interval.ms
  ctx.font       = '500 10px Inter, system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.textBaseline = 'middle'

  for (let t = first; t <= rangeEnd; t += interval.ms) {
    const x = Math.round(msToX(t))
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth   = 1
    ctx.beginPath()
    ctx.moveTo(x + 0.5, h * 0.5)
    ctx.lineTo(x + 0.5, h)
    ctx.stroke()

    const d = new Date(t)
    let label
    if (interval.fmt === 'date') label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    else if (interval.fmt === 'hour') label = d.toLocaleTimeString(undefined, { hour: '2-digit', hour12: false })
    else label = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })

    ctx.fillStyle = '#64748b'
    ctx.textAlign = 'left'
    ctx.fillText(label, x + 4, h * 0.5 - 1)
  }

  // minor ticks
  const half = interval.ms / 2
  if (half * pxPerMs >= 20) {
    const firstHalf = Math.ceil(rangeStart / half) * half
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'
    ctx.lineWidth   = 1
    for (let t = firstHalf; t <= rangeEnd; t += half) {
      if (t % interval.ms === 0) continue
      const x = Math.round(msToX(t))
      ctx.beginPath()
      ctx.moveTo(x + 0.5, h * 0.72)
      ctx.lineTo(x + 0.5, h)
      ctx.stroke()
    }
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(0, h - 0.5)
  ctx.lineTo(width, h - 0.5)
  ctx.stroke()
}

function applyDrag(arr, from, to) {
  const r = [...arr]
  const [item] = r.splice(from, 1)
  r.splice(to, 0, item)
  return r
}

const Timeline = forwardRef(function Timeline(
  { events, tracks, range, pxPerHour, setPxPerHour, settings, onReorderTracks, onEditCategory, onUpdateEvent, onOpenEdit, onOpenNew, onDeleteEvent, loading, apiError },
  ref
) {
  const scrollRef       = useRef(null)
  const rulerRef        = useRef(null)
  const headerListRef   = useRef(null)
  const headersRef      = useRef(null)
  const tracksLenRef    = useRef(tracks.length)
  const pxRef           = useRef(pxPerHour)
  const rangeRef        = useRef(range)
  const zoomAnchorRef   = useRef(null) // { anchorTime, mouseX } pending scroll correction
  const [dragging, setDragging] = useState(null) // { from, to }
  const [tooltip, setTooltip] = useState(null)   // { event, x, y }
  const [cursorLabel, setCursorLabel] = useState(null)  // { text, x }
  const [now, setNow] = useState(Date.now())

  useEffect(() => { pxRef.current      = pxPerHour    }, [pxPerHour])
  useEffect(() => { rangeRef.current   = range        }, [range])
  useEffect(() => { tracksLenRef.current = tracks.length }, [tracks])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const totalWidth = () => {
    if (!range) return scrollRef.current?.clientWidth ?? 800
    const spanHrs = (range.end - range.start) / 3_600_000
    return Math.max(spanHrs * pxPerHour, scrollRef.current?.clientWidth ?? 800)
  }

  // Expose fitZoom to parent via ref
  useImperativeHandle(ref, () => ({
    fitZoom() {
      if (!rangeRef.current) return
      const spanHrs = (rangeRef.current.end - rangeRef.current.start) / 3_600_000
      const avail   = scrollRef.current?.clientWidth ?? 800
      setPxPerHour(Math.max(MIN_PX_PER_HR, (avail / spanHrs) * 0.92))
    }
  }), [setPxPerHour])

  // Draw ruler
  useEffect(() => {
    if (!rulerRef.current || !range) return
    const w = totalWidth()
    drawRuler(rulerRef.current, range.start, range.end, pxPerHour, w)
  }, [range, pxPerHour])

  // Apply scroll correction after pxPerHour state has been committed to DOM
  useEffect(() => {
    const anchor = zoomAnchorRef.current
    if (!anchor || !rangeRef.current || !scrollRef.current) return
    zoomAnchorRef.current = null
    const newAnchorX = ((anchor.anchorTime - rangeRef.current.start) / 3_600_000) * pxPerHour
    scrollRef.current.scrollLeft = newAnchorX - anchor.mouseX
  }, [pxPerHour])

  // Wheel zoom (anchored to cursor)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e) => {
      if (e.shiftKey) return
      e.preventDefault()
      const r = rangeRef.current
      if (!r) return
      const factor     = e.deltaY < 0 ? 1.12 : 1 / 1.12
      const rect       = el.getBoundingClientRect()
      const mouseX     = e.clientX - rect.left
      const anchorX    = mouseX + el.scrollLeft
      const anchorTime = r.start + (anchorX / pxRef.current) * 3_600_000
      const newPx      = Math.max(MIN_PX_PER_HR, Math.min(MAX_PX_PER_HR, pxRef.current * factor))
      zoomAnchorRef.current = { anchorTime, mouseX }
      setPxPerHour(newPx)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setPxPerHour])

  // Sync header vertical scroll
  useEffect(() => {
    const el = scrollRef.current
    const hl = headerListRef.current
    if (!el || !hl) return
    const onScroll = () => { hl.style.transform = `translateY(-${el.scrollTop}px)` }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const handleTooltip = useCallback((event, x, y) => {
    setTooltip(event ? { event, x, y } : null)
  }, [])

  const handleDeleteEvent = useCallback(async (id) => {
    const ev = events.find(e => e.id === id)
    if (!ev || !confirm(`Delete "${ev.title}"?`)) return
    await onDeleteEvent(id)
  }, [events, onDeleteEvent])

  const handleHeaderDragStart = useCallback((e, fromIndex) => {
    e.preventDefault()
    setDragging({ from: fromIndex, to: fromIndex })

    const onMove = (mv) => {
      const panel = headersRef.current
      if (!panel) return
      const rect = panel.getBoundingClientRect()
      const relY  = mv.clientY - rect.top - RULER_HEIGHT + (scrollRef.current?.scrollTop ?? 0)
      const to    = Math.max(0, Math.min(tracksLenRef.current - 1, Math.floor(relY / TRACK_HEIGHT)))
      setDragging(prev => prev ? { ...prev, to } : null)
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setDragging(prev => {
        if (prev && prev.from !== prev.to) onReorderTracks(prev.from, prev.to)
        return null
      })
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [onReorderTracks])

  const handleRulerMouseDown = useCallback((e) => {
    e.preventDefault()
    const startX      = e.clientX
    const startScroll = scrollRef.current.scrollLeft
    const ruler       = rulerRef.current

    ruler.style.cursor = 'grabbing'

    const onMove = (mv) => {
      scrollRef.current.scrollLeft = startScroll - (mv.clientX - startX)
    }
    const onUp = () => {
      ruler.style.cursor = 'grab'
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }, [])

  const handleLaneClick = useCallback((e, trackName) => {
    if (e.target.closest('.event-block')) return
    if (!range) return
    const rect      = e.currentTarget.getBoundingClientRect()
    const x         = e.clientX - rect.left + scrollRef.current.scrollLeft
    const clickedMs = range.start + (x / pxPerHour) * 3_600_000
    onOpenNew({
      category: trackName,
      start: toLocalISO(new Date(clickedMs)),
      end:   toLocalISO(new Date(clickedMs + 3_600_000)),
    })
  }, [range, pxPerHour, onOpenNew])

  const handleMouseMove = useCallback((e) => {
    if (!range) return
    const rect = scrollRef.current?.getBoundingClientRect()
    if (!rect) return
    const x  = e.clientX - rect.left + scrollRef.current.scrollLeft
    const ms = range.start + (x / pxPerHour) * 3_600_000
    setCursorLabel({ text: fmtDateTime(ms), x: e.clientX - rect.left + 175 })
  }, [range, pxPerHour])

  const displayedTracks = dragging ? applyDrag(tracks, dragging.from, dragging.to) : tracks
  const trackColorMap   = Object.fromEntries(displayedTracks.map(t => [t.name, t.color]))
  const trackIndexMap   = Object.fromEntries(displayedTracks.map((t, i) => [t.name, i]))
  const evById         = Object.fromEntries(events.map(e => [e.id, e]))
  const w = totalWidth()

  const nowX = range ? ((now - range.start) / 3_600_000) * pxPerHour : null
  const nowInRange = nowX !== null && nowX >= 0 && nowX <= w
  const svgH = RULER_HEIGHT + displayedTracks.length * TRACK_HEIGHT

  const { arrows, criticalEventIds } = useMemo(() => {
    if (!range) return { arrows: [], criticalEventIds: new Set() }

    const byId = Object.fromEntries(events.map(e => [e.id, e]))

    // Build successor map
    const successors = Object.fromEntries(events.map(e => [e.id, []]))
    for (const ev of events)
      for (const depId of (ev.depends_on || []))
        if (successors[depId]) successors[depId].push(ev.id)

    // Topological sort — Kahn's algorithm
    const inDeg = Object.fromEntries(
      events.map(e => [e.id, (e.depends_on || []).filter(id => byId[id]).length])
    )
    const queue = events.filter(e => inDeg[e.id] === 0).map(e => e.id)
    const order = []
    while (queue.length) {
      const id = queue.shift()
      order.push(id)
      for (const sid of successors[id])
        if (--inDeg[sid] === 0) queue.push(sid)
    }
    // Append any events in cycles (can't fully CPM these, include them)
    const inOrder = new Set(order)
    for (const ev of events) if (!inOrder.has(ev.id)) order.push(ev.id)

    // Use durations (ms) so ES is relative — avoids calendar-offset inflating float
    const dur = Object.fromEntries(events.map(e => [e.id, new Date(e.end) - new Date(e.start)]))

    // Forward pass — earliest start/finish driven by predecessor completions
    const ES = {}, EF = {}
    for (const id of order) {
      const ev    = byId[id]
      const preds = (ev.depends_on || []).filter(pid => byId[pid])
      ES[id] = preds.length === 0 ? 0 : Math.max(...preds.map(pid => EF[pid] ?? 0))
      EF[id] = ES[id] + dur[id]
    }

    // Backward pass — latest allowable start/finish
    const projectEnd = Math.max(...Object.values(EF))
    const LF = {}, LS = {}
    for (const id of [...order].reverse()) {
      const succs = successors[id]
      LF[id] = succs.length === 0 ? projectEnd : Math.min(...succs.map(sid => LS[sid] ?? 0))
      LS[id] = LF[id] - dur[id]
    }

    // Total float = LS - ES; critical = float ≤ 1-minute tolerance
    const TOL = 60_000
    const criticalEventIds = new Set(
      events.filter(e => (LS[e.id] - ES[e.id]) <= TOL).map(e => e.id)
    )

    // Critical links: both endpoints on critical path
    const criticalLinks = new Set()
    for (const ev of events) {
      if (!criticalEventIds.has(ev.id)) continue
      for (const depId of (ev.depends_on || []))
        if (criticalEventIds.has(depId)) criticalLinks.add(`${depId}->${ev.id}`)
    }

    // Build arrow geometry
    const arrows = []
    for (const ev of events) {
      if (!ev.depends_on?.length) continue
      const ti2       = trackIndexMap[ev.category] ?? 0
      const evStartMs = new Date(ev.start).getTime()
      const x2 = ((evStartMs - range.start) / 3_600_000) * pxPerHour
      const y2 = RULER_HEIGHT + ti2 * TRACK_HEIGHT + TRACK_HEIGHT / 2

      for (const depId of ev.depends_on) {
        const dep = byId[depId]
        if (!dep) continue
        const ti1      = trackIndexMap[dep.category] ?? 0
        const depEndMs = new Date(dep.end).getTime()
        const x1 = ((depEndMs - range.start) / 3_600_000) * pxPerHour
        const y1 = RULER_HEIGHT + ti1 * TRACK_HEIGHT + TRACK_HEIGHT / 2
        arrows.push({ x1, y1, x2, y2, critical: criticalLinks.has(`${depId}->${ev.id}`) })
      }
    }

    return { arrows, criticalEventIds }
  }, [events, range, pxPerHour, trackIndexMap])

  return (
    <div className="timeline-wrapper">
      {/* Track header panel */}
      <div className="headers-panel" ref={headersRef}>
        <div className="ruler-spacer" />
        <div className="header-list" ref={headerListRef}>
          {displayedTracks.map((t, i) => {
            const origIndex = tracks.indexOf(t)
            const isDragging  = dragging && origIndex === dragging.from
            const isTarget    = dragging && i === dragging.to && dragging.from !== dragging.to
            return (
              <div
                key={t.name}
                className={`track-header${isDragging ? ' is-dragging' : ''}${isTarget ? ' is-drop-target' : ''}`}
              >
                <div
                  className="drag-handle"
                  onMouseDown={e => handleHeaderDragStart(e, i)}
                  title="Drag to reorder"
                >⠿</div>
                <div className="track-swatch" style={{ background: t.color }} />
                <span className="track-name" onClick={() => onEditCategory(t)}>{t.name}</span>
                <span className="track-count">{events.filter(e => e.category === t.name).length}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Scroll area */}
      <div
        className="timeline-scroll"
        ref={scrollRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setCursorLabel(null)}
      >
        <div className="timeline-inner" style={{ width: w + 'px' }}>
          <canvas className="ruler" ref={rulerRef} height={RULER_HEIGHT} onMouseDown={handleRulerMouseDown} />

          {nowInRange && (
            <div className="now-line" style={{ left: nowX + 'px' }}>
              <div className="now-line-label">{fmtTime(now)}</div>
            </div>
          )}

          {(() => {
            const visibleArrows = !settings?.showArrows ? [] :
              settings?.showOnlyCritical ? arrows.filter(a => a.critical) : arrows
            return visibleArrows.length > 0 && (
              <svg className="dep-arrows" width={w} height={svgH} style={{ top: 0 }}>
                <defs>
                  <marker id="arr-normal" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                    <path d="M0,0 L0,7 L7,3.5 z" fill="rgba(129,140,248,0.65)" />
                  </marker>
                  <marker id="arr-critical" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                    <path d="M0,0 L0,7 L7,3.5 z" fill="rgba(248,113,113,0.9)" />
                  </marker>
                </defs>
                {visibleArrows.map((a, i) => {
                  const span = Math.abs(a.x2 - a.x1)
                  const cx1  = a.x1 + span * 0.45
                  const cx2  = a.x2 - span * 0.45
                  return (
                    <path
                      key={i}
                      d={`M${a.x1},${a.y1} C${cx1},${a.y1} ${cx2},${a.y2} ${a.x2},${a.y2}`}
                      fill="none"
                      stroke={a.critical ? 'rgba(248,113,113,0.85)' : 'rgba(129,140,248,0.55)'}
                      strokeWidth={a.critical ? 2 : 1.5}
                      strokeDasharray={a.critical ? undefined : '5,3'}
                      markerEnd={a.critical ? 'url(#arr-critical)' : 'url(#arr-normal)'}
                    />
                  )
                })}
              </svg>
            )
          })()}

          <div className="track-lanes">
            {loading && (
              <div className="empty-state">
                <div className="icon">⏳</div>
                <p>Loading…</p>
              </div>
            )}
            {apiError && (
              <div className="empty-state">
                <div className="icon">⚠</div>
                <p>{apiError}</p>
              </div>
            )}
            {!loading && !apiError && events.length === 0 && (
              <div className="empty-state">
                <div className="icon">&#9776;</div>
                <p>No events. Click <strong>+ New Event</strong> to add one.</p>
              </div>
            )}
            {displayedTracks.map(t => {
              const trackEvents = events
                .filter(e => e.category === t.name)
                .filter(e => !settings?.showOnlyCritical || criticalEventIds.has(e.id))
              return (
                <div
                  key={t.name}
                  className="track-lane"
                  data-category={t.name}
                  onDoubleClick={e => handleLaneClick(e, t.name)}
                >
                  {trackEvents.map(ev => (
                    <EventBlock
                      key={ev.id}
                      event={ev}
                      rangeStart={range?.start ?? 0}
                      pxPerHour={pxPerHour}
                      trackColor={trackColorMap[ev.category]}
                      trackColorMap={trackColorMap}
                      isCritical={criticalEventIds.has(ev.id)}
                      snapMinutes={settings?.snapMinutes ?? 0}
                      onUpdate={onUpdateEvent}
                      onEdit={onOpenEdit}
                      onDelete={handleDeleteEvent}
                      onTooltip={handleTooltip}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Cursor label */}
      {cursorLabel && (
        <div className="cursor-label" style={{ left: cursorLabel.x + 'px' }}>
          {cursorLabel.text}
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="tooltip"
          style={{
            left: Math.min(tooltip.x + 12, window.innerWidth - 280) + 'px',
            top:  tooltip.y + 16 + 'px',
          }}
        >
          <div className="tt-title">{tooltip.event.title}</div>
          <div className="tt-time">
            {fmtTime(new Date(tooltip.event.start).getTime())} &ndash; {fmtTime(new Date(tooltip.event.end).getTime())}
          </div>
          {tooltip.event.notes && <div className="tt-notes">{tooltip.event.notes}</div>}
          <div className="tt-track">{tooltip.event.category}</div>
        </div>
      )}
    </div>
  )
})

export default Timeline
