import { useRef, useEffect, useLayoutEffect, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from 'react'
import { RULER_HEIGHT, TRACK_HEIGHT, TICK_INTERVALS, MIN_PX_PER_HR, MAX_PX_PER_HR } from '../constants'
import EventBlock from './EventBlock'
import Minimap from './Minimap'

const clampPx = (px) => Math.max(MIN_PX_PER_HR, Math.min(MAX_PX_PER_HR, px))

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

// Sub-day tasks read in clock time; multi-day tasks read in calendar dates.
function fmtSpan(startMs, endMs) {
  if ((endMs - startMs) < 86_400_000) return `${fmtTime(startMs)} – ${fmtTime(endMs)}`
  const d = ms => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${d(startMs)} – ${d(endMs)}`
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
  const span     = rangeEnd - rangeStart
  // Pick the smallest interval that's both readable (>=56px apart) AND keeps the total
  // tick count bounded — otherwise a long span at a high zoom tries to draw tens of
  // thousands of ticks and freezes the tab.
  let interval   = TICK_INTERVALS[TICK_INTERVALS.length - 1]
  for (const iv of TICK_INTERVALS) {
    if (iv.ms * pxPerMs >= 56 && span / iv.ms <= 600) { interval = iv; break }
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
    if (interval.fmt === 'year') label = String(d.getFullYear())
    else if (interval.fmt === 'month') label = d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    else if (interval.fmt === 'date') label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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
  { events, tracks, range, pxPerHour, setPxPerHour, settings, canEdit = true, onReorderTracks, onEditCategory, onUpdateEvent, onOpenEdit, onOpenNew, onDeleteEvent, onOpenTasks, loading, apiError },
  ref
) {
  const scrollRef       = useRef(null)
  const rulerRef        = useRef(null)
  const headerListRef   = useRef(null)
  const headersRef      = useRef(null)
  const tracksLenRef    = useRef(tracks.length)
  const tracksRef       = useRef(tracks)
  const pxRef           = useRef(pxPerHour)
  const rangeRef        = useRef(range)
  const zoomAnchorRef   = useRef(null) // { anchorTime, mouseX } pending scroll correction
  const [dragging, setDragging] = useState(null) // { from, to }
  const [tooltip, setTooltip] = useState(null)   // { event, x, y }
  const cursorLabelRef = useRef(null)  // updated imperatively on mouse-move (no re-render)
  const [now, setNow] = useState(Date.now())

  useEffect(() => { pxRef.current      = pxPerHour    }, [pxPerHour])
  useEffect(() => { rangeRef.current   = range        }, [range])
  useEffect(() => { tracksLenRef.current = tracks.length; tracksRef.current = tracks }, [tracks])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const totalWidth = () => {
    if (!range) return scrollRef.current?.clientWidth ?? 800
    const spanHrs = (range.end - range.start) / 3_600_000
    return Math.max(spanHrs * pxPerHour, scrollRef.current?.clientWidth ?? 800)
  }

  // ── Smooth zoom engine ─────────────────────────────────────────────────────
  // Every zoom (wheel/pinch, buttons, keys, fit) eases pxPerHour toward a target via
  // one rAF loop; re-anchoring happens synchronously before paint (useLayoutEffect),
  // so zoom glides instead of snapping.
  const zoomTargetRef = useRef(null)   // { px, anchorTime, mouseX }
  const zoomRafRef    = useRef(null)
  const frameRafRef   = useRef(null)

  const zoomStep = useCallback(() => {
    const t = zoomTargetRef.current
    if (!t) { zoomRafRef.current = null; return }
    const cur  = pxRef.current
    const diff = t.px - cur
    let next
    if (Math.abs(diff) <= t.px * 0.004) { next = t.px; zoomTargetRef.current = null }
    else next = cur + diff * 0.3
    zoomAnchorRef.current = { anchorTime: t.anchorTime, mouseX: t.mouseX }
    setPxPerHour(next)
    zoomRafRef.current = zoomTargetRef.current ? requestAnimationFrame(zoomStep) : null
  }, [setPxPerHour])

  // Aim the zoom at an absolute pxPerHour, keeping the time under `clientX` fixed.
  const zoomTo = useCallback((targetPx, clientX) => {
    const el = scrollRef.current
    const r  = rangeRef.current
    if (!el || !r) return
    const rect    = el.getBoundingClientRect()
    const mouseX  = (clientX != null ? clientX : rect.left + rect.width / 2) - rect.left
    const anchorX = mouseX + el.scrollLeft
    const anchorTime = r.start + (anchorX / pxRef.current) * 3_600_000
    zoomTargetRef.current = { px: clampPx(targetPx), anchorTime, mouseX }
    if (!zoomRafRef.current) zoomRafRef.current = requestAnimationFrame(zoomStep)
  }, [zoomStep])

  // Multiply the *pending* target so rapid steps compound smoothly.
  const zoomByFactor = useCallback((factor, clientX) => {
    const base = zoomTargetRef.current ? zoomTargetRef.current.px : pxRef.current
    zoomTo(base * factor, clientX)
  }, [zoomTo])

  const doFit = useCallback(() => {
    const r = rangeRef.current
    if (!r) return
    const spanHrs = (r.end - r.start) / 3_600_000
    const avail   = scrollRef.current?.clientWidth ?? 800
    zoomTo((avail / spanHrs) * 0.92, null)
  }, [zoomTo])

  // Smoothly frame a time window [fromMs, toMs] with `fromMs` near the left edge — eases
  // the zoom while re-anchoring `fromMs` at the margin each frame (reuses zoomAnchorRef).
  const frameWindow = useCallback((fromMs, toMs) => {
    const el = scrollRef.current
    const r  = rangeRef.current
    if (!el || !r) return
    zoomTargetRef.current = null
    cancelAnimationFrame(zoomRafRef.current); zoomRafRef.current = null
    const margin   = Math.max(8, el.clientWidth * 0.02)
    const hours    = Math.max(1 / 60, (toMs - fromMs) / 3_600_000)
    const targetPx = clampPx((el.clientWidth - margin * 2) / hours)
    const startPx  = pxRef.current
    const t0 = performance.now(), dur = 240
    cancelAnimationFrame(frameRafRef.current)
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur)
      const e = 1 - Math.pow(1 - k, 3)
      zoomAnchorRef.current = { anchorTime: fromMs, mouseX: margin }
      setPxPerHour(startPx + (targetPx - startPx) * e)
      if (k < 1) frameRafRef.current = requestAnimationFrame(step)
    }
    frameRafRef.current = requestAnimationFrame(step)
  }, [setPxPerHour])

  useEffect(() => () => {
    cancelAnimationFrame(zoomRafRef.current)
    cancelAnimationFrame(frameRafRef.current)
  }, [])

  // Navigation controls exposed to the toolbar buttons + keyboard shortcuts.
  useImperativeHandle(ref, () => ({
    fitZoom: doFit,
    zoomBy:  (factor) => zoomByFactor(factor),
    frameWindow,
    panBy:   (dx, dy = 0) => { const el = scrollRef.current; if (el) { el.scrollLeft += dx; el.scrollTop += dy } },
    scrollToStart: () => { const el = scrollRef.current; if (el) el.scrollLeft = 0 },
    scrollToEnd:   () => { const el = scrollRef.current; if (el) el.scrollLeft = el.scrollWidth },
  }), [doFit, zoomByFactor, frameWindow])

  // Draw ruler in the layout phase so it stays in sync with the blocks while zooming.
  useLayoutEffect(() => {
    if (!rulerRef.current || !range) return
    const w = totalWidth()
    drawRuler(rulerRef.current, range.start, range.end, pxPerHour, w)
  }, [range, pxPerHour])

  // Re-anchor scroll synchronously BEFORE paint so zoom doesn't visibly snap then correct.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current
    if (!anchor || !rangeRef.current || !scrollRef.current) return
    zoomAnchorRef.current = null
    const newAnchorX = ((anchor.anchorTime - rangeRef.current.start) / 3_600_000) * pxPerHour
    scrollRef.current.scrollLeft = newAnchorX - anchor.mouseX
  }, [pxPerHour])

  // Cross-platform wheel: Ctrl/Cmd (or trackpad pinch, which sets ctrlKey) zooms at the
  // cursor; Shift forces horizontal pan; plain scroll pans (a vertical wheel is redirected
  // to horizontal when the tracks don't overflow, so the wheel always moves the timeline).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        // Magnitude-proportional factor → smooth for both trackpad pinch and wheel notches.
        zoomByFactor(Math.pow(1.0015, -e.deltaY), e.clientX)
        return
      }
      if (e.shiftKey) {
        e.preventDefault()
        el.scrollLeft += (e.deltaX !== 0 ? e.deltaX : e.deltaY)
        return
      }
      const canScrollVert = el.scrollHeight > el.clientHeight + 1
      if (!canScrollVert && e.deltaX === 0 && e.deltaY !== 0) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
      // else: let native scrolling handle it (trackpad two-finger swipe / vertical track scroll)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomByFactor])

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
      const ts = tracksRef.current, hts = layoutRef.current.heights
      let acc = 0, to = ts.length - 1
      for (let i = 0; i < ts.length; i++) {
        const h = hts[ts[i].name] || TRACK_HEIGHT
        if (relY < acc + h) { to = i; break }
        acc += h
      }
      to = Math.max(0, Math.min(ts.length - 1, to))
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

  // Drag any empty part of the timeline (ruler or lanes) to pan — works with mouse,
  // trackpad, or touch. Event blocks keep their own move/resize drag.
  const handlePanStart = useCallback((e) => {
    if (e.button !== 0) return
    // Pan even when the drag starts over an event (events only move with Ctrl/⌘, which
    // stops propagation before this runs). Only the action buttons opt out.
    if (e.target.closest('.event-actions')) return
    const el = scrollRef.current
    if (!el) return
    e.preventDefault()
    const startX = e.clientX, startY = e.clientY
    const sl = el.scrollLeft, st = el.scrollTop
    el.classList.add('panning')
    const onMove = (mv) => {
      el.scrollLeft = sl - (mv.clientX - startX)
      el.scrollTop  = st - (mv.clientY - startY)
    }
    const onUp = () => {
      el.classList.remove('panning')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }, [])

  // Keyboard navigation (ignored while typing in a field or when a modal is open).
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return
      if (document.querySelector('.modal-overlay')) return
      const el = scrollRef.current
      if (!el) return
      const step = Math.max(60, el.clientWidth * 0.15)
      switch (e.key) {
        case '+': case '=': e.preventDefault(); zoomByFactor(1.6); break
        case '-': case '_': e.preventDefault(); zoomByFactor(1 / 1.6); break
        case '0':           e.preventDefault(); doFit(); break
        case 'ArrowLeft':   e.preventDefault(); el.scrollLeft -= step; break
        case 'ArrowRight':  e.preventDefault(); el.scrollLeft += step; break
        case 'ArrowUp':     e.preventDefault(); el.scrollTop  -= step; break
        case 'ArrowDown':   e.preventDefault(); el.scrollTop  += step; break
        case 'Home':        e.preventDefault(); el.scrollLeft = 0; break
        case 'End':         e.preventDefault(); el.scrollLeft = el.scrollWidth; break
        default: break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomByFactor, doFit])

  // Show a "move" cursor over events while Ctrl/⌘ is held (the modifier that arms dragging).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const sync  = (e) => el.classList.toggle('armed', e.ctrlKey || e.metaKey)
    const clear = () => el.classList.remove('armed')
    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
      window.removeEventListener('blur', clear)
    }
  }, [])

  const handleLaneClick = useCallback((e, trackName) => {
    if (!canEdit) return
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
    const el = scrollRef.current
    const label = cursorLabelRef.current
    if (!range || !el || !label) return
    const rect = el.getBoundingClientRect()
    const x  = e.clientX - rect.left + el.scrollLeft
    const ms = range.start + (x / pxPerHour) * 3_600_000
    label.textContent   = fmtDateTime(ms)
    label.style.left    = (e.clientX - rect.left + 175) + 'px'
    label.style.display = 'block'
  }, [range, pxPerHour])

  const displayedTracks = useMemo(
    () => dragging ? applyDrag(tracks, dragging.from, dragging.to) : tracks,
    [tracks, dragging],
  )
  // Memoized so they keep a stable identity across renders — otherwise they'd bust the
  // CPM memo and EventBlock's React.memo on every render (incl. every mouse move).
  const trackColorMap = useMemo(
    () => Object.fromEntries(displayedTracks.map(t => [t.name, t.color])),
    [displayedTracks],
  )
  const trackIndexMap = useMemo(
    () => Object.fromEntries(displayedTracks.map((t, i) => [t.name, i])),
    [displayedTracks],
  )
  const eventsByCategory = useMemo(() => {
    const m = {}
    for (const e of events) (m[e.category] ??= []).push(e)
    return m
  }, [events])

  // Stack events that overlap in time within a category into sub-rows (greedy interval
  // packing), so a lane grows taller instead of drawing overlapping events on top of each
  // other. Produces each event's sub-row, and each track's pixel offset + height.
  const layout = useMemo(() => {
    const rowOf = {}, tops = {}, heights = {}
    let y = 0
    for (const t of displayedTracks) {
      const evs = (eventsByCategory[t.name] || [])
        .map(e => ({ id: e.id, s: new Date(e.start).getTime(), en: new Date(e.end).getTime() }))
        .sort((a, b) => a.s - b.s)
      const laneEnd = []
      for (const it of evs) {
        let lane = laneEnd.findIndex(end => it.s >= end)
        if (lane < 0) { lane = laneEnd.length; laneEnd.push(0) }
        laneEnd[lane] = it.en
        rowOf[it.id] = lane
      }
      const depth = Math.max(1, laneEnd.length)
      heights[t.name] = depth * TRACK_HEIGHT
      tops[t.name] = y
      y += heights[t.name]
    }
    return { rowOf, tops, heights, total: y }
  }, [displayedTracks, eventsByCategory])
  const layoutRef = useRef(layout)
  useEffect(() => { layoutRef.current = layout }, [layout])

  const w = totalWidth()

  const nowX = range ? ((now - range.start) / 3_600_000) * pxPerHour : null
  const nowInRange = nowX !== null && nowX >= 0 && nowX <= w
  const svgH = RULER_HEIGHT + layout.total

  // ── Critical-path analysis (CPM) — depends ONLY on events' durations & dependencies.
  // Does not recompute while panning / zooming / hovering.
  const { criticalEventIds, criticalLinks } = useMemo(() => {
    if (!events.length) return { criticalEventIds: new Set(), criticalLinks: new Set() }

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

    return { criticalEventIds, criticalLinks }
  }, [events])

  // ── Arrow geometry — depends on layout (zoom, range, track order). Cheap O(edges).
  const arrows = useMemo(() => {
    if (!range) return []
    const byId = Object.fromEntries(events.map(e => [e.id, e]))
    const out = []
    for (const ev of events) {
      if (!ev.depends_on?.length) continue
      const x2  = ((new Date(ev.start).getTime() - range.start) / 3_600_000) * pxPerHour
      const y2  = RULER_HEIGHT + (layout.tops[ev.category] ?? 0) + (layout.rowOf[ev.id] ?? 0) * TRACK_HEIGHT + TRACK_HEIGHT / 2
      for (const depId of ev.depends_on) {
        const dep = byId[depId]
        if (!dep) continue
        const x1  = ((new Date(dep.end).getTime() - range.start) / 3_600_000) * pxPerHour
        const y1  = RULER_HEIGHT + (layout.tops[dep.category] ?? 0) + (layout.rowOf[dep.id] ?? 0) * TRACK_HEIGHT + TRACK_HEIGHT / 2
        out.push({ x1, y1, x2, y2, critical: criticalLinks.has(`${depId}->${ev.id}`) })
      }
    }
    return out
  }, [events, range, pxPerHour, layout, criticalLinks])

  return (
    <div className="timeline-main">
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
                style={{ height: layout.heights[t.name] + 'px' }}
              >
                <div
                  className="drag-handle"
                  onMouseDown={canEdit ? (e => handleHeaderDragStart(e, i)) : undefined}
                  title={canEdit ? 'Drag to reorder' : ''}
                  style={canEdit ? undefined : { visibility: 'hidden' }}
                >⠿</div>
                <div className="track-swatch" style={{ background: t.color }} />
                <span
                  className={canEdit ? 'track-name' : 'track-name track-name--static'}
                  onClick={canEdit ? (() => onEditCategory(t)) : undefined}
                >{t.name}</span>
                <span className="track-count">{(eventsByCategory[t.name] || []).length}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Scroll area */}
      <div
        className="timeline-scroll"
        ref={scrollRef}
        onMouseDown={handlePanStart}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { if (cursorLabelRef.current) cursorLabelRef.current.style.display = 'none' }}
      >
        <div className="timeline-inner" style={{ width: w + 'px' }}>
          <canvas className="ruler" ref={rulerRef} height={RULER_HEIGHT} />

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
              const trackEvents = (eventsByCategory[t.name] || [])
                .filter(e => !settings?.showOnlyCritical || criticalEventIds.has(e.id))
              return (
                <div
                  key={t.name}
                  className="track-lane"
                  data-category={t.name}
                  style={{ height: layout.heights[t.name] + 'px' }}
                  onDoubleClick={e => handleLaneClick(e, t.name)}
                >
                  {trackEvents.map(ev => (
                    <EventBlock
                      key={ev.id}
                      event={ev}
                      rangeStart={range?.start ?? 0}
                      pxPerHour={pxPerHour}
                      top={8 + (layout.rowOf[ev.id] ?? 0) * TRACK_HEIGHT}
                      trackColor={trackColorMap[ev.category]}
                      trackColorMap={trackColorMap}
                      isCritical={criticalEventIds.has(ev.id)}
                      snapMinutes={settings?.snapMinutes ?? 0}
                      autoPanSpeed={settings?.autoPanSpeed ?? 64}
                      canEdit={canEdit}
                      onUpdate={onUpdateEvent}
                      onEdit={onOpenEdit}
                      onDelete={handleDeleteEvent}
                      onTooltip={handleTooltip}
                      onOpenTasks={onOpenTasks}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      </div>{/* /timeline-wrapper */}

      <Minimap
        scrollRef={scrollRef}
        range={range}
        pxPerHour={pxPerHour}
        events={events}
        trackColorMap={trackColorMap}
        trackIndexMap={trackIndexMap}
        trackCount={displayedTracks.length}
      />

      {/* Cursor label — updated imperatively in handleMouseMove to avoid a re-render per move */}
      <div className="cursor-label" ref={cursorLabelRef} style={{ display: 'none' }} />

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
            {fmtSpan(new Date(tooltip.event.start).getTime(), new Date(tooltip.event.end).getTime())}
          </div>
          <div className={`tt-tasks${tooltip.event.task_count > 0 ? '' : ' tt-tasks--none'}`}>
            {tooltip.event.task_count > 0
              ? `${tooltip.event.task_count} task${tooltip.event.task_count === 1 ? '' : 's'} · ${tooltip.event.tasks_done || 0} done`
              : 'No tasks'}
          </div>
          {tooltip.event.notes && <div className="tt-notes">{tooltip.event.notes}</div>}
          <div className="tt-track">{tooltip.event.category}</div>
          {canEdit && <div className="tt-hint">Click to edit · ⌘/Ctrl-drag to move</div>}
        </div>
      )}
    </div>
  )
})

export default Timeline
