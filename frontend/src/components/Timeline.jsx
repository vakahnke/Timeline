import { useRef, useEffect, useLayoutEffect, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from 'react'
import { RULER_HEIGHT, TRACK_HEIGHT, TICK_INTERVALS, MIN_PX_PER_HR, MAX_PX_PER_HR } from '../constants'
import EventBlock from './EventBlock'
import Minimap from './Minimap'
import { useToast } from '../ui/ToastProvider'

// Label for the modifier that arms event dragging, matching what the keyboard says.
const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl'

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

// Draw ONLY the visible slice of the ruler onto a viewport-sized canvas (redrawn on scroll).
// The old approach sized the canvas to the full content width, which at a high zoom became a
// multi-hundred-thousand-pixel canvas (past the browser's ~65k limit) — huge memory + reallocated
// every zoom frame. This keeps the canvas ~viewport-wide regardless of zoom. `scrollLeft` is the
// content offset of the viewport's left edge; `vw` is the viewport width in CSS px.
function drawRuler(canvas, rangeStart, pxPerHour, scrollLeft, vw, dpr) {
  const h  = RULER_HEIGHT
  const cw = Math.max(1, Math.ceil(vw))
  if (canvas.width !== cw * dpr || canvas.height !== h * dpr) {
    canvas.width  = cw * dpr
    canvas.height = h * dpr
  }
  canvas.style.width  = cw + 'px'
  canvas.style.height = h + 'px'
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)   // crisp on retina; draw in CSS px
  ctx.clearRect(0, 0, cw, h)
  ctx.fillStyle = '#0f1219'
  ctx.fillRect(0, 0, cw, h)

  const pxPerMs = pxPerHour / 3_600_000
  // Major (labeled) ticks: smallest interval whose label stays readable (>=56px apart).
  // Iterating only the visible window bounds the tick count naturally.
  let major = TICK_INTERVALS[TICK_INTERVALS.length - 1]
  for (const iv of TICK_INTERVALS) {
    if (iv.ms * pxPerMs >= 56) { major = iv; break }
  }
  // Minor (unlabeled) ticks: subdivide the major span down to the natural next unit, so the
  // tick density tracks the scale — a month view gets a tick per day, a day view a tick per
  // hour, a week view something in between. Largest interval below the major that is still
  // >=8px apart (denser than that reads as a blur, so we stop).
  let minor = null
  for (const iv of TICK_INTERVALS) {
    if (iv.ms < major.ms && iv.ms * pxPerMs >= 8) minor = iv   // ascending list -> keep the largest
  }

  const startVis = rangeStart + (scrollLeft / pxPerHour) * 3_600_000
  const endVis   = rangeStart + ((scrollLeft + cw) / pxPerHour) * 3_600_000
  const x = ms => ((ms - rangeStart) / 3_600_000) * pxPerHour - scrollLeft   // canvas-local x
  ctx.font = '500 10px Inter, system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.textBaseline = 'middle'

  // Minor ticks first (shorter + dimmer), skipping any that land on a major tick.
  if (minor) {
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'
    ctx.lineWidth   = 1
    const firstMinor = Math.ceil(startVis / minor.ms) * minor.ms
    for (let t = firstMinor; t <= endVis; t += minor.ms) {
      if (t % major.ms === 0) continue
      const cx = Math.round(x(t))
      ctx.beginPath(); ctx.moveTo(cx + 0.5, h * 0.66); ctx.lineTo(cx + 0.5, h); ctx.stroke()
    }
  }

  // Major ticks + labels.
  const first = Math.ceil(startVis / major.ms) * major.ms
  for (let t = first; t <= endVis; t += major.ms) {
    const cx = Math.round(x(t))
    ctx.strokeStyle = 'rgba(255,255,255,0.13)'
    ctx.lineWidth   = 1
    ctx.beginPath(); ctx.moveTo(cx + 0.5, h * 0.48); ctx.lineTo(cx + 0.5, h); ctx.stroke()

    const d = new Date(t)
    let label
    if (major.fmt === 'year') label = String(d.getFullYear())
    else if (major.fmt === 'month') label = d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    else if (major.fmt === 'date') label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    else if (major.fmt === 'hour') label = d.toLocaleTimeString(undefined, { hour: '2-digit', hour12: false })
    else label = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })

    ctx.fillStyle = '#64748b'
    ctx.textAlign = 'left'
    ctx.fillText(label, cx + 4, h * 0.5 - 1)
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth   = 1
  ctx.beginPath(); ctx.moveTo(0, h - 0.5); ctx.lineTo(cw, h - 0.5); ctx.stroke()
}

function applyDrag(arr, from, to) {
  const r = [...arr]
  const [item] = r.splice(from, 1)
  r.splice(to, 0, item)
  return r
}

// Draw the zebra track-lane backgrounds + bottom borders onto a VIEWPORT-sized canvas, replacing
// six sticky 100vw `.lane-bg` divs. WebKit composites many sticky/large layers very slowly, which
// was the remaining Today->view transition lag in Safari; one canvas layer fixes it. `bands` carry
// content-space y (top already +RULER_HEIGHT); we subtract scrollTop and fill the full width.
function drawLaneBg(canvas, bands, scrollTop, vw, vh, dpr, colors) {
  const cw = Math.max(1, Math.ceil(vw)), ch = Math.max(1, Math.ceil(vh))
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) { canvas.width = cw * dpr; canvas.height = ch * dpr }
  canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px'
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  for (const b of bands) {
    const y = b.top - scrollTop
    if (y > ch || y + b.height < 0) continue
    ctx.fillStyle = b.even ? colors.bg : colors.bgMid
    ctx.fillRect(0, y, cw, b.height)
    ctx.fillStyle = colors.border
    ctx.fillRect(0, y + b.height - 1, cw, 1)   // bottom divider
  }
}

// Draw the dependency arrows onto a VIEWPORT-sized canvas (offset by scroll), instead of an SVG.
// An SVG that re-renders every scroll frame is fine in Blink but stalls WebKit/Safari badly
// (layer churn + per-frame DOM diff). Canvas is one cheap layer that both engines handle well.
// `arrows` carry content-space coords (x already ×pxPerHour, y already +RULER_HEIGHT); we subtract
// scrollLeft/scrollTop to place them, and cull anything off-screen.
function drawArrows(canvas, arrows, scrollLeft, scrollTop, vw, vh, dpr) {
  const cw = Math.max(1, Math.ceil(vw)), ch = Math.max(1, Math.ceil(vh))
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) { canvas.width = cw * dpr; canvas.height = ch * dpr }
  canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px'
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  const PAD = 40
  for (const a of arrows) {
    const x1 = a.x1 - scrollLeft, x2 = a.x2 - scrollLeft
    const y1 = a.y1 - scrollTop,  y2 = a.y2 - scrollTop
    if (Math.max(x1, x2) < -PAD || Math.min(x1, x2) > cw + PAD) continue
    if (Math.max(y1, y2) < -PAD || Math.min(y1, y2) > ch + PAD) continue
    const span = Math.abs(x2 - x1)
    const cx1 = x1 + span * 0.45, cx2 = x2 - span * 0.45
    ctx.strokeStyle = a.critical ? 'rgba(248,113,113,0.85)' : 'rgba(129,140,248,0.55)'
    ctx.lineWidth   = a.critical ? 2 : 1.5
    ctx.setLineDash(a.critical ? [] : [5, 3])
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.bezierCurveTo(cx1, y1, cx2, y2, x2, y2)
    ctx.stroke()
    ctx.setLineDash([])
    // Arrowhead at the target end. The curve arrives horizontally (its end control point shares
    // y2), so the head points right — matching the old SVG marker (refX=5, 7×7).
    ctx.fillStyle = a.critical ? 'rgba(248,113,113,0.9)' : 'rgba(129,140,248,0.65)'
    ctx.beginPath()
    ctx.moveTo(x2 + 2, y2)
    ctx.lineTo(x2 - 5, y2 - 3.5)
    ctx.lineTo(x2 - 5, y2 + 3.5)
    ctx.closePath()
    ctx.fill()
  }
}

const Timeline = forwardRef(function Timeline(
  { events, tracks, range, pxPerHour, setPxPerHour, settings, canEdit = true, onReorderTracks, onEditCategory, onUpdateEvent, onOpenEdit, onOpenNew, onDeleteEvent, onOpenTasks, onMoveEvents, onFit, loading, apiError },
  ref
) {
  const scrollRef       = useRef(null)
  const rulerRef        = useRef(null)
  const arrowsCanvasRef = useRef(null)
  const arrowsDataRef   = useRef([])
  const laneBgRef       = useRef(null)
  const laneBandsRef    = useRef([])
  const laneColorsRef   = useRef(null)
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

  // Multi-select: Shift-click events into a set; Ctrl/⌘-drag any of them moves the group.
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])
  const clearSelection = useCallback(() => setSelectedIds(prev => (prev.size ? new Set() : prev)), [])
  const lanesDownRef = useRef(null)   // distinguishes a clean empty-space click (clears selection) from a pan
  const [marquee, setMarquee] = useState(null)   // {left,top,width,height} screen rect while shift-dragging a box
  const marqueeingRef = useRef(false)            // suppress event tooltips while the box is being dragged
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') clearSelection() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [clearSelection])
  // Bridge a group drag (a single time delta) to the project's bulk move (one undo step).
  const handleGroupMove = useCallback((deltaMs) => {
    const updates = events
      .filter(ev => selectedIds.has(ev.id))
      .map(ev => ({
        id: ev.id,
        patch: {
          start: new Date(new Date(ev.start).getTime() + deltaMs).toISOString(),
          end:   new Date(new Date(ev.end).getTime() + deltaMs).toISOString(),
        },
      }))
    return onMoveEvents?.(updates)
  }, [events, selectedIds, onMoveEvents])

  // Layout phase (not passive) so frameWindow, called from the parent's layout effect right
  // after a setRange, reads the NEW range/zoom synchronously — no one-frame lag, no jump.
  useLayoutEffect(() => { pxRef.current    = pxPerHour }, [pxPerHour])
  useLayoutEffect(() => { rangeRef.current = range     }, [range])
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
  // `instant` jumps in one step (Fit button); otherwise the rAF loop eases (pinch/wheel/±).
  const zoomTo = useCallback((targetPx, clientX, instant = false) => {
    const el = scrollRef.current
    const r  = rangeRef.current
    if (!el || !r) return
    // Stop any in-flight frameWindow (Today/Week/Month) animation, else its rAF loop and this
    // one both setPxPerHour every frame and fight — the stutter when toggling Fit <-> Today.
    cancelAnimationFrame(frameRafRef.current); frameRafRef.current = null
    const rect    = el.getBoundingClientRect()
    const mouseX  = (clientX != null ? clientX : rect.left + rect.width / 2) - rect.left
    const anchorX = mouseX + el.scrollLeft
    const anchorTime = r.start + (anchorX / pxRef.current) * 3_600_000
    const px = clampPx(targetPx)
    if (instant) {
      cancelAnimationFrame(zoomRafRef.current); zoomRafRef.current = null; zoomTargetRef.current = null
      if (px !== pxRef.current) {
        zoomAnchorRef.current = { anchorTime, mouseX }   // [pxPerHour] effect keeps this time fixed before paint
        setPxPerHour(px)
      }
      return
    }
    zoomTargetRef.current = { px, anchorTime, mouseX }
    if (!zoomRafRef.current) zoomRafRef.current = requestAnimationFrame(zoomStep)
  }, [zoomStep, setPxPerHour])

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
    zoomTo((avail / spanHrs) * 0.92, null, true)   // instant — snap, like the framing buttons
  }, [zoomTo])

  // Instant framing (Today/Week/Month): jump straight to the zoom that fits [fromMs, toMs]
  // with `fromMs` at the left edge. No animation loop → nothing to stutter or collide with
  // the pinch/wheel zoom loop, and the arrows/ruler repaint exactly once, on landing.
  const frameWindow = useCallback((fromMs, toMs) => {
    const el = scrollRef.current
    const r  = rangeRef.current
    if (!el || !r) return
    // Kill any in-flight animation from either loop before jumping.
    cancelAnimationFrame(zoomRafRef.current); zoomRafRef.current = null; zoomTargetRef.current = null
    cancelAnimationFrame(frameRafRef.current); frameRafRef.current = null
    const margin   = Math.max(8, el.clientWidth * 0.02)
    const hours    = Math.max(1 / 60, (toMs - fromMs) / 3_600_000)
    const targetPx = clampPx((el.clientWidth - margin * 2) / hours)
    if (targetPx !== pxRef.current) {
      // Zoom changes: the [pxPerHour] layout effect anchors `from` at the margin before paint.
      zoomAnchorRef.current = { anchorTime: fromMs, mouseX: margin }
      setPxPerHour(targetPx)
    } else {
      // Zoom already matches (e.g. Today pressed twice): just re-center the scroll.
      el.scrollLeft = ((fromMs - r.start) / 3_600_000) * targetPx - margin
    }
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

  // Paint the visible slice of the ruler onto the viewport-sized canvas. Reads live refs so the
  // scroll/resize listeners and the zoom layout-effect all share one code path.
  const paintRuler = useCallback(() => {
    const c = rulerRef.current, el = scrollRef.current, r = rangeRef.current
    if (!c || !el || !r) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)   // cap dpr so retina can't balloon cost
    drawRuler(c, r.start, pxRef.current, el.scrollLeft, el.clientWidth, dpr)
  }, [])

  // Same idea for the dependency arrows: a viewport-sized canvas, translated to follow scroll and
  // redrawn imperatively (no per-scroll React render — the whole point of moving off SVG).
  const paintArrows = useCallback(() => {
    const c = arrowsCanvasRef.current, el = scrollRef.current
    if (!c || !el) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const sl = el.scrollLeft, st = el.scrollTop
    c.style.transform = `translate(${sl}px, ${st}px)`
    drawArrows(c, arrowsDataRef.current, sl, st, el.clientWidth, el.clientHeight, dpr)
  }, [])

  // ...and the zebra lane backgrounds, same viewport-canvas approach (replaces 6 sticky layers).
  const paintLaneBg = useCallback(() => {
    const c = laneBgRef.current, el = scrollRef.current
    if (!c || !el) return
    if (!laneColorsRef.current) {
      const cs = getComputedStyle(document.documentElement)
      laneColorsRef.current = {
        bg:     cs.getPropertyValue('--bg').trim()     || '#09090f',
        bgMid:  cs.getPropertyValue('--bg-mid').trim() || '#0d1017',
        border: cs.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.06)',
      }
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const sl = el.scrollLeft, st = el.scrollTop
    c.style.transform = `translate(${sl}px, ${st}px)`
    drawLaneBg(c, laneBandsRef.current, st, el.clientWidth, el.clientHeight, dpr, laneColorsRef.current)
  }, [])

  // Redraw in the layout phase so they stay in sync with the blocks while zooming/range-changing.
  useLayoutEffect(() => { paintLaneBg(); paintRuler(); paintArrows() }, [range, pxPerHour, paintRuler, paintArrows, paintLaneBg])

  // Redraw the (viewport-sized) lane backgrounds + ruler + arrows as you scroll, and on resize.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const redraw = () => { paintLaneBg(); paintRuler(); paintArrows() }
    el.addEventListener('scroll', redraw, { passive: true })
    window.addEventListener('resize', redraw)
    return () => { el.removeEventListener('scroll', redraw); window.removeEventListener('resize', redraw) }
  }, [paintRuler, paintArrows, paintLaneBg])

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

  // Two-finger pinch (touch): zoom tracks the fingers 1:1, anchored at their midpoint, and
  // the midpoint's travel pans, so pinch-and-drag feels like a map. Uses touch events rather
  // than pointer events on purpose: preventDefault() on a two-touch touchmove is the one
  // reliable, cross-browser way to stop the browser claiming the gesture (page zoom on iOS,
  // two-finger scroll + pointercancel on Chrome). One finger is left entirely to native
  // scrolling. The easing loop is bypassed — a pinch must not lag the fingers.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let pinch = null      // { d0, px0, anchorTime, y0, top0 }
    let pending = null    // latest { d, midX, midY } awaiting a frame
    let raf = null

    const read = (t) => {
      const [a, b] = [t[0], t[1]]
      return {
        d:    Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        midX: (a.clientX + b.clientX) / 2,
        midY: (a.clientY + b.clientY) / 2,
      }
    }

    const apply = () => {
      raf = null
      const r = rangeRef.current
      if (!pinch || !pending || !r) return
      const rect   = el.getBoundingClientRect()
      const mouseX = pending.midX - rect.left
      const px     = clampPx(pinch.px0 * (pending.d / pinch.d0))
      if (px !== pxRef.current) {
        zoomAnchorRef.current = { anchorTime: pinch.anchorTime, mouseX }   // re-anchored before paint
        setPxPerHour(px)
      } else {
        // At a zoom limit (or a pure two-finger drag): keep the anchored time under the midpoint.
        el.scrollLeft = ((pinch.anchorTime - r.start) / 3_600_000) * px - mouseX
      }
      el.scrollTop = pinch.top0 - (pending.midY - pinch.y0)
    }

    const onStart = (e) => {
      if (e.touches.length !== 2) { pinch = null; return }
      const r = rangeRef.current
      if (!r) return
      e.preventDefault()
      // Stop any in-flight eased zoom so it cannot fight the fingers.
      cancelAnimationFrame(zoomRafRef.current); zoomRafRef.current = null; zoomTargetRef.current = null
      cancelAnimationFrame(frameRafRef.current); frameRafRef.current = null
      const { d, midX, midY } = read(e.touches)
      const rect = el.getBoundingClientRect()
      const anchorX = (midX - rect.left) + el.scrollLeft
      pinch = {
        d0: Math.max(1, d),
        px0: pxRef.current,
        anchorTime: r.start + (anchorX / pxRef.current) * 3_600_000,
        y0: midY,
        top0: el.scrollTop,
      }
      setTooltip(null)
    }
    const onMove = (e) => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      pending = read(e.touches)
      if (!raf) raf = requestAnimationFrame(apply)
    }
    const onEnd = (e) => { if (e.touches.length < 2) { pinch = null; pending = null } }
    const noGesture = (e) => e.preventDefault()   // iOS Safari's own page-zoom gesture

    el.addEventListener('touchstart',  onStart, { passive: false })
    el.addEventListener('touchmove',   onMove,  { passive: false })
    el.addEventListener('touchend',    onEnd)
    el.addEventListener('touchcancel', onEnd)
    el.addEventListener('gesturestart',  noGesture)
    el.addEventListener('gesturechange', noGesture)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      el.removeEventListener('touchstart',  onStart)
      el.removeEventListener('touchmove',   onMove)
      el.removeEventListener('touchend',    onEnd)
      el.removeEventListener('touchcancel', onEnd)
      el.removeEventListener('gesturestart',  noGesture)
      el.removeEventListener('gesturechange', noGesture)
    }
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

  // A plain drag on an event pans instead of moving it; that is nearly always someone
  // who does not know about the modifier yet, so teach it right then (at most every 20s).
  const { flash } = useToast()
  const lastHintRef = useRef(0)
  const handlePlainDrag = useCallback(() => {
    const now = Date.now()
    if (now - lastHintRef.current < 20000) return
    lastHintRef.current = now
    flash(`Hold ${MOD_KEY} while dragging to move an event · a plain drag pans`, 'hint')
  }, [flash])

  // First visit on a touch device: say what the gestures are (the touch twin of the Ctrl/⌘ hint).
  const [showCoach, setShowCoach] = useState(() => {
    try {
      return !!window.matchMedia?.('(hover: none)').matches && !localStorage.getItem('timeline:touchCoach')
    } catch { return false }
  })
  const dismissCoach = useCallback(() => {
    setShowCoach(false)
    try { localStorage.setItem('timeline:touchCoach', '1') } catch { /* private mode */ }
  }, [])

  const handleTooltip = useCallback((event, x, y) => {
    if (marqueeingRef.current) { setTooltip(null); return }
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
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      setDragging(prev => {
        if (prev && prev.from !== prev.to) onReorderTracks(prev.from, prev.to)
        return null
      })
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [onReorderTracks])

  // Drag any empty part of the timeline (ruler or lanes) to pan — works with mouse,
  // trackpad, or touch. Event blocks keep their own move/resize drag.
  // Shift-drag on empty timeline space draws a box; every event it touches is added to the
  // selection on release. Plain drag still pans.
  const startMarquee = useCallback((e) => {
    const el = scrollRef.current
    if (!el) return
    e.preventDefault()
    const rect = el.getBoundingClientRect()
    const clampX = x => Math.max(rect.left, Math.min(rect.right, x))
    const clampY = y => Math.max(rect.top, Math.min(rect.bottom, y))
    const x0 = clampX(e.clientX), y0 = clampY(e.clientY)
    let active = false
    const onMove = (mv) => {
      if (!active && Math.abs(mv.clientX - e.clientX) < 4 && Math.abs(mv.clientY - e.clientY) < 4) return
      if (!active) { active = true; marqueeingRef.current = true; setTooltip(null) }
      const x1 = clampX(mv.clientX), y1 = clampY(mv.clientY)
      setMarquee({ left: Math.min(x0, x1), top: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) })
    }
    const onUp = (up) => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      marqueeingRef.current = false
      setMarquee(null)
      if (!active) return
      const x1 = clampX(up.clientX), y1 = clampY(up.clientY)
      const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1)
      const hit = new Set()
      el.querySelectorAll('.event-block').forEach(b => {
        const r = b.getBoundingClientRect()
        if (r.left < maxX && r.right > minX && r.top < maxY && r.bottom > minY) hit.add(Number(b.dataset.eventId))
      })
      if (hit.size) setSelectedIds(prev => { const n = new Set(prev); hit.forEach(id => n.add(id)); return n })
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [])

  const handlePanStart = useCallback((e) => {
    // Touch pans by native scrolling (momentum, off the main thread); see the pinch effect
    // below for two fingers. This JS pan is for mouse and pen.
    if (e.pointerType === 'touch') return
    if (e.button !== 0) return
    // Pan even when the drag starts over an event (events only move with Ctrl/⌘, which
    // stops propagation before this runs). Only the action buttons opt out.
    if (e.target.closest('.event-actions')) return
    if (e.shiftKey && !e.target.closest('.event-block')) { startMarquee(e); return }   // shift-drag = marquee select
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
      document.removeEventListener('pointermove',   onMove)
      document.removeEventListener('pointerup',     onUp)
      document.removeEventListener('pointercancel', onUp)
    }
    document.addEventListener('pointermove',   onMove)
    document.addEventListener('pointerup',     onUp)
    document.addEventListener('pointercancel', onUp)
  }, [startMarquee])

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
        case '0':           e.preventDefault(); (onFit || doFit)(); break   // onFit re-expands a narrowed range
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
  }, [zoomByFactor, doFit, onFit])

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
    if (e.pointerType === 'touch') return   // the cursor time-label is a hover affordance
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

  // Per-event name-label placement: alternate above/below within each row so adjacent
  // labels never collide, and cap each at the gap to the NEXT same-side event (~two over) —
  // which roughly doubles the room vs. putting every label on one side.
  const labelInfo = useMemo(() => {
    const start = range?.start ?? 0
    const xOf = ms => ((ms - start) / 3_600_000) * pxPerHour
    const byRow = {}
    for (const e of events) {
      const key = e.category + '#' + (layout.rowOf[e.id] ?? 0)
      ;(byRow[key] ??= []).push(e)
    }
    const m = {}
    for (const key in byRow) {
      const arr = byRow[key].slice().sort((a, b) => new Date(a.start) - new Date(b.start))
      const xs = arr.map(e => xOf(new Date(e.start).getTime()))
      for (let i = 0; i < arr.length; i++) {
        const sameSide = arr[i + 2]   // the next label on this event's side is two over
        m[arr[i].id] = {
          side: i % 2 === 0 ? 'above' : 'below',
          max: sameSide ? Math.max(0, xs[i + 2] - xs[i] - 6) : Infinity,
        }
      }
    }
    return m
  }, [events, layout, range, pxPerHour])

  // Keep an event's name visible whenever its bar's start has scrolled off the left edge
  // while the bar is still on screen: slide the inner label right so it stays at the left
  // edge (clamped to the bar). Geometry is computed in JS (no per-scroll reflow), and only
  // the few bars currently crossing the left edge get a DOM write.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const start = range?.start ?? 0
    const xOf = ms => ((ms - start) / 3_600_000) * pxPerHour
    const bars = events.map(e => {
      const left  = xOf(new Date(e.start).getTime())
      const width = Math.max(4, xOf(new Date(e.end).getTime()) - left)
      return { id: e.id, left, width, labelW: (e.title?.length || 0) * 6.5 + 28 }
    })
    const innerOf = (id) => el.querySelector(`.event-block[data-event-id="${id}"] .event-inner`)
    const stuck = new Set()
    const update = () => {
      const sl = el.scrollLeft
      const now = new Set()
      for (const b of bars) {
        // start off-screen-left, bar still visible, and wide enough to hold its name inside
        if (b.left < sl && b.left + b.width > sl + 4 && b.width > b.labelW + 8) {
          now.add(b.id)
          const inner = innerOf(b.id)
          if (inner) inner.style.transform = `translateX(${Math.max(0, Math.min(sl - b.left, b.width - b.labelW))}px)`
        }
      }
      for (const id of stuck) if (!now.has(id)) { const i = innerOf(id); if (i) i.style.transform = '' }
      stuck.clear(); now.forEach(id => stuck.add(id))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      el.removeEventListener('scroll', update)
      for (const id of stuck) { const i = innerOf(id); if (i) i.style.transform = '' }
    }
  }, [events, pxPerHour, range])

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

  // Arrows actually drawn, honoring the show-arrows / critical-only settings.
  const visibleArrows = useMemo(() =>
    !settings?.showArrows ? [] : settings?.showOnlyCritical ? arrows.filter(a => a.critical) : arrows,
    [arrows, settings?.showArrows, settings?.showOnlyCritical])

  // Push the current arrow set into the ref the imperative painter reads, then repaint.
  useLayoutEffect(() => { arrowsDataRef.current = visibleArrows; paintArrows() }, [visibleArrows, paintArrows])

  // Track-lane bands (zebra + heights) for the lane-background canvas.
  useLayoutEffect(() => {
    laneBandsRef.current = displayedTracks.map((t, i) => ({
      top:    RULER_HEIGHT + (layout.tops[t.name] ?? 0),
      height: layout.heights[t.name] ?? 0,
      even:   (i % 2 === 1),   // matches .track-lane:nth-child(even)
    }))
    paintLaneBg()
  }, [displayedTracks, layout, paintLaneBg])

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
                  onPointerDown={canEdit ? (e => handleHeaderDragStart(e, i)) : undefined}
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
        onPointerDown={handlePanStart}
        onPointerMove={handleMouseMove}
        onPointerLeave={() => { if (cursorLabelRef.current) cursorLabelRef.current.style.display = 'none' }}
      >
        <div className="timeline-inner" style={{ width: w + 'px' }}>
          {/* Zebra lane backgrounds: a viewport-pinned canvas behind the blocks (see paintLaneBg). */}
          <canvas className="lane-bgs-canvas" ref={laneBgRef} />
          <canvas className="ruler" ref={rulerRef} />

          {nowInRange && (
            <div className="now-line" style={{ left: nowX + 'px' }}>
              <div className="now-line-label">{fmtTime(now)}</div>
            </div>
          )}

          {/* Dependency arrows: a viewport-pinned canvas, drawn imperatively (see paintArrows). */}
          <canvas className="dep-arrows-canvas" ref={arrowsCanvasRef} />

          <div
            className="track-lanes"
            onPointerDown={e => { lanesDownRef.current = { x: e.clientX, y: e.clientY } }}
            onClick={e => {
              const d = lanesDownRef.current
              if (d && !e.shiftKey && Math.abs(e.clientX - d.x) < 5 && Math.abs(e.clientY - d.y) < 5 && !e.target.closest('.event-block')) clearSelection()
            }}
          >
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
                // Only render bars that overlap the current range. Events are positioned by
                // absolute time, so an off-range bar (e.g. a 2027 task while the day view is
                // bounded to ~2 weeks around today) would otherwise render hundreds of thousands
                // of px wide/away — a giant GPU layer. Off-range bars can't be scrolled to anyway.
                .filter(e => !range ||
                  (new Date(e.end).getTime() >= range.start && new Date(e.start).getTime() <= range.end))
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
                      top={(TRACK_HEIGHT - 48) / 2 + (layout.rowOf[ev.id] ?? 0) * TRACK_HEIGHT}
                      labelMaxWidth={labelInfo[ev.id]?.max}
                      labelSide={labelInfo[ev.id]?.side}
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
                      onPlainDrag={handlePlainDrag}
                      onOpenTasks={onOpenTasks}
                      selected={selectedIds.has(ev.id)}
                      selectedIds={selectedIds}
                      onToggleSelect={toggleSelect}
                      onGroupMove={handleGroupMove}
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

      {/* Marquee selection box (shift-drag) */}
      {marquee && (
        <div className="marquee" style={{ left: marquee.left + 'px', top: marquee.top + 'px', width: marquee.width + 'px', height: marquee.height + 'px' }} />
      )}

      {showCoach && canEdit && (
        <div className="touch-coach" role="note">
          <span>Drag to pan · pinch to zoom · <b>press and hold</b> an event to move it, then use the dots to resize</span>
          <button type="button" onClick={dismissCoach}>Got it</button>
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
            {fmtSpan(new Date(tooltip.event.start).getTime(), new Date(tooltip.event.end).getTime())}
          </div>
          <div className={`tt-tasks${tooltip.event.task_count > 0 ? '' : ' tt-tasks--none'}`}>
            {tooltip.event.task_count > 0
              ? `${tooltip.event.task_count} task${tooltip.event.task_count === 1 ? '' : 's'} · ${tooltip.event.tasks_done || 0} done`
              : 'No tasks'}
          </div>
          {tooltip.event.notes && <div className="tt-notes">{tooltip.event.notes}</div>}
          <div className="tt-track">{tooltip.event.category}</div>
          {canEdit && <div className="tt-hint"><kbd>{MOD_KEY}</kbd>-drag to move · click to edit</div>}
        </div>
      )}
    </div>
  )
})

export default Timeline
