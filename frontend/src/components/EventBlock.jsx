import { useRef, useCallback, useState, useEffect, memo } from 'react'

// Touch: press and hold this long (without moving more than the slop) to pick an event up.
// The touch counterpart of the Ctrl/⌘ modifier: a quick swipe that starts on an event still pans.
const LONG_PRESS_MS = 400
const PRESS_SLOP_PX = 8
const DOT_HALF = 22   // half of the 44px grab-dot hit area
const DOT_OUT  = 8    // how far outside the event's edge a dot is centred

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Sub-day tasks read in clock time; multi-day tasks read in calendar dates.
function fmtSpan(startMs, endMs) {
  return (endMs - startMs) < 86_400_000
    ? `${fmtTime(startMs)} – ${fmtTime(endMs)}`
    : `${fmtDate(startMs)} – ${fmtDate(endMs)}`
}

function hexToRgba(hex, alpha) {
  if (!hex || hex[0] !== '#') return `rgba(100,120,200,${alpha})`
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

function snap(ms, snapMinutes) {
  if (!snapMinutes) return ms
  const grid = snapMinutes * 60_000
  return Math.round(ms / grid) * grid
}

function EventBlock({ event, rangeStart, pxPerHour, trackColor, trackColorMap, isCritical, snapMinutes, top = 8, canEdit = true, autoPanSpeed = 64, labelMaxWidth = Infinity, labelSide = 'above', selected = false, selectedIds, onToggleSelect, onGroupMove, onUpdate, onEdit, onDelete, onTooltip, onOpenTasks, onPlainDrag }) {
  const blockRef = useRef(null)

  // Touch-selected: set after a long-press (or a touch move). Shows the two grab dots used
  // to resize by touch. Any touch/click elsewhere clears it.
  const [touchSel, setTouchSel] = useState(false)
  useEffect(() => {
    if (!touchSel) return
    const off = (ev) => {
      if (blockRef.current?.contains(ev.target) || ev.target.closest?.('.grab-dot')) return
      setTouchSel(false)
    }
    document.addEventListener('pointerdown', off, true)
    return () => document.removeEventListener('pointerdown', off, true)
  }, [touchSel])

  // Lane/category is the source of truth for color, so an event can never visually
  // drift from its category (a per-event color is only a fallback for the rare event
  // whose category has no color).
  const color   = trackColor || event.color || '#4a88ff'
  const startMs = new Date(event.start).getTime()
  const endMs   = new Date(event.end).getTime()
  const x       = ((startMs - rangeStart) / 3_600_000) * pxPerHour
  const w       = Math.max(4, ((endMs - startMs) / 3_600_000) * pxPerHour)
  // Too narrow to hold the name? Show it floating just above the bar instead (rough
  // text-width estimate for the 11px label).
  const nameFits = w >= event.title.length * 6.5 + 14

  // ── Drag to move (horizontal + vertical track switching) ──────────────────
  const handleMoveDown = useCallback((e) => {
    if (!canEdit) return
    if (e.button !== 0) return
    const isTouch = e.pointerType === 'touch'
    // The hover buttons (tasks / edit / delete) are ordinary buttons, so a plain press on one must
    // not start a drag. But on an event about 140px wide they begin at the centre and cover nearly
    // half of it, so with Ctrl/⌘ held (an explicit "I am moving this") a press there moves the
    // event like anywhere else. Only the buttons count, never the gaps in the strip around them.
    const onButton = e.target.closest('.event-actions button') || e.target.closest('.event-tasks-badge')
    if (onButton && !(e.ctrlKey || e.metaKey)) return
    // The edge strips are a mouse affordance (Ctrl/⌘-drag to resize). A finger that lands on
    // one still means "this event" — on a narrow block the strips are most of its width.
    if (!isTouch && e.target.closest('.resize-handle')) return

    // Run `fn` on this pointer's release. A touch that turns into a native scroll ends with
    // pointercancel instead of pointerup, so listen for both or the listener leaks and fires
    // on some later, unrelated tap.
    const onRelease = (fn) => {
      const done = () => {
        document.removeEventListener('pointerup', up)
        document.removeEventListener('pointercancel', done)
      }
      const up = (u) => { done(); fn(u) }
      document.addEventListener('pointerup', up)
      document.addEventListener('pointercancel', done)
    }

    // Shift-click toggles this event in/out of the multi-selection (no move, no pan).
    if (e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      const cx = e.clientX, cy = e.clientY
      onRelease((u) => {
        if (Math.abs(u.clientX - cx) < 5 && Math.abs(u.clientY - cy) < 5) onToggleSelect?.(event.id)
      })
      return
    }

    const beginMove = (e, viaTouch = false) => {
    // A Ctrl/⌘ press may begin on one of the hover buttons (see handleMoveDown).
    const startedOnButton = !!e.target?.closest?.('.event-actions button, .event-tasks-badge')
    e.preventDefault?.()
    e.stopPropagation?.()
    const pid = e.pointerId
    const noCtx = (ev) => ev.preventDefault()   // suppress the macOS Ctrl-click context menu
    document.addEventListener('contextmenu', noCtx)

    const el       = blockRef.current
    const mouseX0  = e.clientX
    const mouseY0  = e.clientY
    const capPx    = pxPerHour
    const capStart = rangeStart
    const capSnap  = snapMinutes
    const s0 = new Date(event.start).getTime()
    const e0 = new Date(event.end).getTime()
    const dur = e0 - s0
    const msToX = ms => ((ms - capStart) / 3_600_000) * capPx
    const timeEl = el.querySelector('.event-time')
    const scroller = el.closest('.timeline-scroll')   // auto-pan target so an event can be dragged past the visible range
    const scroll0  = scroller ? scroller.scrollLeft : 0

    // Group move: Ctrl/⌘-dragging one of several selected events shifts them all by the
    // same amount (horizontal only — each keeps its own track).
    const groupMode = !!(selectedIds && selectedIds.has(event.id) && selectedIds.size > 1)
    const moveNodes = (groupMode && scroller)
      ? [...scroller.querySelectorAll('.event-block')].filter(n => selectedIds.has(Number(n.dataset.eventId)))
      : [el]
    const orig = moveNodes.map(n => ({
      n, left: parseFloat(n.style.left) || 0, top: n.style.top,
      w: n.offsetWidth, h: n.offsetHeight, color: n.style.borderColor || color,
    }))

    let moved = false
    let activeLane = null
    let lastX = e.clientX, lastY = e.clientY
    let ghosts = []   // faded placeholders left at each start position so the move is easy to eyeball / undo

    el.classList.add('dragging')
    if (viaTouch) el.classList.add('lifted')
    document.body.style.cursor = 'grabbing'

    // Find the track lane under the cursor without hitting the dragged block
    const getLaneAt = (clientX, clientY) => {
      el.style.pointerEvents = 'none'
      const target = document.elementFromPoint(clientX, clientY)?.closest('.track-lane')
      el.style.pointerEvents = ''
      return target
    }

    const setActiveLane = (lane) => {
      if (activeLane === lane) return
      activeLane?.classList.remove('drag-over')
      lane?.classList.add('drag-over')
      activeLane = lane
    }

    // Position under the cursor, accounting for any auto-pan since drag start. Unsnapped
    // while dragging (smooth); snapped once on release. Group mode shifts every selected
    // block by the same pixels — horizontal only, no track change.
    const place = (clientX, clientY) => {
      const scrollDelta = scroller ? scroller.scrollLeft - scroll0 : 0
      const dx = (clientX - mouseX0) + scrollDelta
      const newS = s0 + (dx / capPx) * 3_600_000
      if (groupMode) {
        for (const o of orig) o.n.style.left = (o.left + dx) + 'px'
      } else {
        el.style.left = msToX(newS) + 'px'
        el.style.top  = (top + (clientY - mouseY0)) + 'px'
        setActiveLane(getLaneAt(clientX, clientY))
      }
      if (timeEl) timeEl.textContent = fmtSpan(newS, newS + dur)
      return newS
    }

    // Edge auto-scroll: nearing the viewport edge pans the timeline so an event can be
    // dragged far past the current view (e.g. from the project's end to its beginning).
    const EDGE = 70, MAX_SPEED = autoPanSpeed, MIN_SPEED = Math.min(12, autoPanSpeed)   // px/frame; floored so it never crawls, ramps up toward the edge
    let autoVel = 0, raf = 0
    const tick = () => {
      if (autoVel !== 0 && scroller) {
        const before = scroller.scrollLeft
        scroller.scrollLeft += autoVel
        if (scroller.scrollLeft !== before) place(lastX, lastY)   // re-place only if the pan actually moved
      }
      raf = autoVel !== 0 ? requestAnimationFrame(tick) : 0
    }
    const speedFor = (depth) => MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.min(1, depth / EDGE)
    const updateAutoScroll = (clientX) => {
      if (!scroller) return
      const r = scroller.getBoundingClientRect()
      autoVel =
        clientX < r.left + EDGE  ? -speedFor(r.left + EDGE - clientX) :
        clientX > r.right - EDGE ?  speedFor(clientX - (r.right - EDGE)) : 0
      if (autoVel !== 0 && !raf) raf = requestAnimationFrame(tick)
    }

    const onMove = (e) => {
      if (viaTouch && e.pointerId !== pid) return   // ignore a second finger
      const dx = e.clientX - mouseX0
      const dy = e.clientY - mouseY0
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      if (!moved) {
        moved = true
        ghosts = orig.map(o => {
          const g = document.createElement('div')
          g.className = 'event-ghost'
          g.style.left = o.left + 'px'; g.style.top = o.top
          g.style.width = o.w + 'px'; g.style.height = o.h + 'px'
          g.style.borderColor = o.color
          o.n.parentNode.appendChild(g)
          return g
        })
      }
      lastX = e.clientX; lastY = e.clientY
      place(e.clientX, e.clientY)
      updateAutoScroll(e.clientX)
    }

    const finish = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
      document.removeEventListener('contextmenu', noCtx)
      autoVel = 0
      if (raf) cancelAnimationFrame(raf)
      ghosts.forEach(g => g.remove())
      el.classList.remove('dragging', 'lifted')
      el.style.top = top + 'px'
      document.body.style.cursor = ''
      activeLane?.classList.remove('drag-over')
    }

    // The browser took the pointer away mid-drag (rare: a system gesture). Put everything back.
    const onCancel = (e) => {
      if (viaTouch && e.pointerId !== pid) return
      finish()
      for (const o of orig) o.n.style.left = o.left + 'px'
      if (timeEl) timeEl.textContent = fmtSpan(s0, e0)
    }

    const onUp = async (e) => {
      if (viaTouch && e.pointerId !== pid) return
      finish()

      // Touch: a long-press always ends selected, so the grab dots are there to resize with.
      if (viaTouch) setTouchSel(true)
      // A click (no drag) opens the editor — so even a tiny block is editable
      // without having to hit the small action button. (A long-press that didn't move just selects.)
      // …unless the press began on a hover button: then the button's own click does its job.
      if (!moved) { if (!viaTouch && !startedOnButton) onEdit(event.id); return }
      // It was a real drag. If it began on a button, the browser still sends that button a click
      // when the mouse comes up; swallow that one click so moving an event never opens a panel.
      if (startedOnButton) {
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault() }
        window.addEventListener('click', swallow, { capture: true, once: true })
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
      }

      const scrollDelta = scroller ? scroller.scrollLeft - scroll0 : 0
      const dx = (e.clientX - mouseX0) + scrollDelta
      // Snap the dragged (anchor) event to the grid; the whole group shifts by that delta.
      const snappedStart = snap(s0 + (dx / capPx) * 3_600_000, capSnap)

      if (groupMode) {
        try { await onGroupMove?.(snappedStart - s0) }
        catch { for (const o of orig) o.n.style.left = o.left + 'px' }   // restore on failure
        return
      }

      const targetLane = getLaneAt(e.clientX, e.clientY)
      const newTrack = targetLane?.dataset.category ?? event.category
      const newColor = trackColorMap?.[newTrack] ?? event.color

      try {
        await onUpdate(event.id, {
          start: new Date(snappedStart).toISOString(),
          end:   new Date(snappedStart + dur).toISOString(),
          category: newTrack,
          color: newColor,
        })
      } catch {
        el.style.left = msToX(s0) + 'px'
        if (timeEl) timeEl.textContent = fmtSpan(s0, e0)
      }
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
    }   // beginMove

    // Touch has no modifier key. A tap opens the editor; a swipe is the browser's native scroll;
    // press-and-hold picks the event up, and the same finger then drags it (time + track).
    if (isTouch) {
      const el = blockRef.current
      const pid = e.pointerId, cx = e.clientX, cy = e.clientY
      let last = e, lifted = false, timer = 0
      const far = (p) => Math.hypot(p.clientX - cx, p.clientY - cy) > PRESS_SLOP_PX
      // Once lifted, keep the browser from turning the drag into a scroll. The finger has not
      // left the slop yet, so no scroll has begun and these touchmoves are still cancelable.
      const blockScroll = (te) => { if (lifted) te.preventDefault() }
      const noMenu = (ev) => ev.preventDefault()          // Android long-press context menu
      const endTouch = (ev) => {
        if (ev.pointerId !== pid) return
        document.removeEventListener('pointerup', endTouch)
        document.removeEventListener('pointercancel', endTouch)
        el.removeEventListener('touchmove', blockScroll)
        el.removeEventListener('contextmenu', noMenu)
        el.classList.remove('pressing')
      }
      const stopWaiting = () => {
        clearTimeout(timer)
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        document.removeEventListener('pointercancel', stopWaiting)
        el.classList.remove('pressing')
      }
      const move = (m) => { if (m.pointerId === pid) { last = m; if (far(m)) stopWaiting() } }   // it is a pan
      const up   = (u) => { if (u.pointerId === pid) { stopWaiting(); if (!far(u)) onEdit(event.id) } }   // a tap
      el.addEventListener('touchmove', blockScroll, { passive: false })
      el.addEventListener('contextmenu', noMenu)
      el.classList.add('pressing')                        // CSS eases the lift in, so the wait reads as feedback
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
      document.addEventListener('pointercancel', stopWaiting)
      document.addEventListener('pointerup', endTouch)
      document.addEventListener('pointercancel', endTouch)
      timer = setTimeout(() => {
        stopWaiting()
        lifted = true
        try { navigator.vibrate?.(10) } catch { /* not supported (iOS) */ }
        beginMove({ clientX: last.clientX, clientY: last.clientY, pointerId: pid }, true)
      }, LONG_PRESS_MS)
      return
    }

    // Events are "sticky": without a modifier, a plain drag pans the timeline (handled by
    // the scroll container — we don't stopPropagation) and a clean click opens the editor.
    // Hold Ctrl/⌘ to actually move the event. A plain drag that started on an event is
    // almost always someone trying to move it, so report it (the timeline shows a hint).
    if (!(e.ctrlKey || e.metaKey)) {
      const cx = e.clientX, cy = e.clientY
      onRelease((up) => {
        if (Math.abs(up.clientX - cx) < 5 && Math.abs(up.clientY - cy) < 5) onEdit(event.id)
        else onPlainDrag?.()
      })
      return
    }
    beginMove(e)
  }, [event, pxPerHour, rangeStart, trackColorMap, top, snapMinutes, autoPanSpeed, color, selectedIds, onToggleSelect, onGroupMove, onUpdate, onEdit])

  // ── Resize handles ────────────────────────────────────────────────────────
  const handleResizeDown = useCallback((e, edge, force = false) => {
    // Sticky: only resize while holding Ctrl/⌘ (otherwise let the timeline pan). The touch
    // grab dots pass `force`: they only exist on an event the user deliberately selected.
    if (!force && !(e.ctrlKey || e.metaKey)) return
    e.stopPropagation()
    e.preventDefault()
    const pid = e.pointerId
    const dot = force ? e.currentTarget : null      // keep the dot under the finger while dragging
    const dotAt = (edgeX) => (edge === 'left' ? edgeX - DOT_OUT : edgeX + DOT_OUT) - DOT_HALF

    const el      = blockRef.current
    const mouseX0 = e.clientX
    const capPx   = pxPerHour
    const capStart = rangeStart
    const capSnap  = snapMinutes
    const s0 = new Date(event.start).getTime()
    const e0 = new Date(event.end).getTime()
    const msToX = ms => ((ms - capStart) / 3_600_000) * capPx
    const timeEl = el.querySelector('.event-time')

    document.body.style.cursor = 'ew-resize'

    const onMove = (e) => {
      if (e.pointerId !== pid) return
      const dtMs = ((e.clientX - mouseX0) / capPx) * 3_600_000
      if (edge === 'left') {
        const newS = Math.min(snap(s0 + dtMs, capSnap), e0 - 300_000)
        el.style.left  = msToX(newS) + 'px'
        el.style.width = Math.max(4, msToX(e0) - msToX(newS)) + 'px'
        if (dot) dot.style.left = dotAt(msToX(newS)) + 'px'
        if (timeEl) timeEl.textContent = fmtSpan(newS, e0)
      } else {
        const newE = Math.max(snap(e0 + dtMs, capSnap), s0 + 300_000)
        el.style.width = Math.max(4, msToX(newE) - msToX(s0)) + 'px'
        if (dot) dot.style.left = dotAt(msToX(newE)) + 'px'
        if (timeEl) timeEl.textContent = fmtSpan(s0, newE)
      }
    }

    const revert = () => {
      el.style.left  = msToX(s0) + 'px'
      el.style.width = Math.max(4, msToX(e0) - msToX(s0)) + 'px'
      if (dot) dot.style.left = dotAt(edge === 'left' ? msToX(s0) : msToX(e0)) + 'px'
      if (timeEl) timeEl.textContent = fmtSpan(s0, e0)
    }
    const stop = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
      document.body.style.cursor = ''
    }
    const onCancel = (e) => { if (e.pointerId === pid) { stop(); revert() } }

    const onUp = async (e) => {
      if (e.pointerId !== pid) return
      stop()

      const dtMs = ((e.clientX - mouseX0) / capPx) * 3_600_000
      let newS = s0, newE = e0
      if (edge === 'left') newS = Math.min(snap(s0 + dtMs, capSnap), e0 - 300_000)
      else                  newE = Math.max(snap(e0 + dtMs, capSnap), s0 + 300_000)

      try {
        await onUpdate(event.id, {
          start: new Date(newS).toISOString(),
          end:   new Date(newE).toISOString(),
        })
      } catch {
        revert()
      }
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
  }, [event, pxPerHour, rangeStart, snapMinutes, onUpdate])

  return (
    <>
    <div
      ref={blockRef}
      data-event-id={event.id}
      className={`event-block${isCritical ? ' critical-path' : ''}${canEdit ? '' : ' readonly'}${event.task_count > 0 ? ' has-tasks' : ''}${selected ? ' selected' : ''}${touchSel ? ' touch-selected' : ''}`}
      style={{
        left:        x + 'px',
        top:         top + 'px',
        width:       w + 'px',
        background:  hexToRgba(color, 0.22),
        borderColor: color,
      }}
      onPointerDown={canEdit ? handleMoveDown : undefined}
      /* Editors open via handleMoveDown's click-vs-drag detection; non-editors (viewer/
         commenter) can't drag, so a plain click opens the event read-only (to read/add comments). */
      onClick={canEdit ? undefined : () => onEdit(event.id)}
      /* Hover tooltip is for pointers that can hover; on touch it would stick after a tap. */
      onPointerEnter={e => { if (e.pointerType !== 'touch') onTooltip(event, e.clientX, e.clientY) }}
      onPointerLeave={() => onTooltip(null)}
    >
      {canEdit && <div className="resize-handle left"  onPointerDown={e => handleResizeDown(e, 'left')} />}
      {canEdit && <div className="resize-handle right" onPointerDown={e => handleResizeDown(e, 'right')} />}

      {(event.percent_complete > 0) && (
        <div className="event-progress" style={{ width: event.percent_complete + '%', background: hexToRgba(color, 0.45) }} />
      )}

      <div className="event-inner">
        {nameFits && <span className="event-title">{event.is_milestone && <span className="event-ms" title="Key milestone" aria-label="Key milestone">◆ </span>}{event.title}</span>}
        <span className="event-time">{fmtSpan(startMs, endMs)}</span>
      </div>

      {event.task_count > 0 && onOpenTasks && (
        <button
          type="button"
          className={`event-tasks-badge${event.tasks_done === event.task_count ? ' all-done' : ''}`}
          title={`${event.tasks_done || 0}/${event.task_count} tasks done — click to open`}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onOpenTasks(event.id) }}
        >
          &#9776; {event.task_count}
        </button>
      )}

      {canEdit && w >= 80 && (
        <div className="event-actions">
          {onOpenTasks && (
            <button className="btn-tasks" title="Tasks" onClick={e => { e.stopPropagation(); onOpenTasks(event.id) }}>&#9776;</button>
          )}
          <button className="btn-edit" title="Edit" onClick={e => { e.stopPropagation(); onEdit(event.id) }}>&#9998;</button>
          <button className="btn-del"  title="Delete" onClick={e => { e.stopPropagation(); onDelete(event.id) }}>&#10005;</button>
        </div>
      )}
    </div>
    {!nameFits && labelMaxWidth >= 24 && (
      <div
        className="event-label-above"
        style={{ left: x + 'px', top: (labelSide === 'below' ? top + 48 : top - 12) + 'px', color, maxWidth: Number.isFinite(labelMaxWidth) ? labelMaxWidth + 'px' : undefined }}
      >{event.title}</div>
    )}
    {/* Touch resize handles: only on an event the user long-pressed. 44px hit area, centred
        just outside each edge so they don't sit on top of each other on a narrow event. */}
    {canEdit && touchSel && (
      <>
        <div className="grab-dot left"  style={{ left: (x - DOT_OUT - DOT_HALF) + 'px', top: (top + 2) + 'px', '--dot': color }}
             onPointerDown={e => handleResizeDown(e, 'left', true)} />
        <div className="grab-dot right" style={{ left: (x + w + DOT_OUT - DOT_HALF) + 'px', top: (top + 2) + 'px', '--dot': color }}
             onPointerDown={e => handleResizeDown(e, 'right', true)} />
      </>
    )}
    </>
  )
}

export default memo(EventBlock)
