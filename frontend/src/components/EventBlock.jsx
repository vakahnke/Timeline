import { useRef, useCallback, memo } from 'react'

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
    if (e.target.closest('.resize-handle') || e.target.closest('.event-actions') || e.target.closest('.event-tasks-badge')) return

    // Shift-click toggles this event in/out of the multi-selection (no move, no pan).
    if (e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      const cx = e.clientX, cy = e.clientY
      const selUp = (u) => {
        document.removeEventListener('mouseup', selUp)
        if (Math.abs(u.clientX - cx) < 5 && Math.abs(u.clientY - cy) < 5) onToggleSelect?.(event.id)
      }
      document.addEventListener('mouseup', selUp)
      return
    }

    // Events are "sticky": without a modifier, a plain drag pans the timeline (handled by
    // the scroll container — we don't stopPropagation) and a clean click opens the editor.
    // Hold Ctrl/⌘ to actually move the event. A plain drag that started on an event is
    // almost always someone trying to move it, so report it (the timeline shows a hint).
    if (!(e.ctrlKey || e.metaKey)) {
      const cx = e.clientX, cy = e.clientY
      const clickUp = (up) => {
        document.removeEventListener('mouseup', clickUp)
        if (Math.abs(up.clientX - cx) < 5 && Math.abs(up.clientY - cy) < 5) onEdit(event.id)
        else onPlainDrag?.()
      }
      document.addEventListener('mouseup', clickUp)
      return
    }

    e.preventDefault()
    e.stopPropagation()
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

    const onUp = async (e) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('contextmenu', noCtx)
      autoVel = 0
      if (raf) cancelAnimationFrame(raf)
      ghosts.forEach(g => g.remove())
      el.classList.remove('dragging')
      el.style.top = top + 'px'
      document.body.style.cursor = ''
      activeLane?.classList.remove('drag-over')

      // A click (no drag) opens the editor — so even a tiny block is editable
      // without having to hit the small action button.
      if (!moved) { onEdit(event.id); return }

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

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [event, pxPerHour, rangeStart, trackColorMap, top, snapMinutes, autoPanSpeed, color, selectedIds, onToggleSelect, onGroupMove, onUpdate, onEdit])

  // ── Resize handles ────────────────────────────────────────────────────────
  const handleResizeDown = useCallback((e, edge) => {
    // Sticky: only resize while holding Ctrl/⌘ (otherwise let the timeline pan).
    if (!(e.ctrlKey || e.metaKey)) return
    e.stopPropagation()
    e.preventDefault()

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
      const dtMs = ((e.clientX - mouseX0) / capPx) * 3_600_000
      if (edge === 'left') {
        const newS = Math.min(snap(s0 + dtMs, capSnap), e0 - 300_000)
        el.style.left  = msToX(newS) + 'px'
        el.style.width = Math.max(4, msToX(e0) - msToX(newS)) + 'px'
        if (timeEl) timeEl.textContent = fmtSpan(newS, e0)
      } else {
        const newE = Math.max(snap(e0 + dtMs, capSnap), s0 + 300_000)
        el.style.width = Math.max(4, msToX(newE) - msToX(s0)) + 'px'
        if (timeEl) timeEl.textContent = fmtSpan(s0, newE)
      }
    }

    const onUp = async (e) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''

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
        el.style.left  = msToX(s0) + 'px'
        el.style.width = Math.max(4, msToX(e0) - msToX(s0)) + 'px'
        if (timeEl) timeEl.textContent = fmtSpan(s0, e0)
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [event, pxPerHour, rangeStart, snapMinutes, onUpdate])

  return (
    <>
    <div
      ref={blockRef}
      data-event-id={event.id}
      className={`event-block${isCritical ? ' critical-path' : ''}${canEdit ? '' : ' readonly'}${event.task_count > 0 ? ' has-tasks' : ''}${selected ? ' selected' : ''}`}
      style={{
        left:        x + 'px',
        top:         top + 'px',
        width:       w + 'px',
        background:  hexToRgba(color, 0.22),
        borderColor: color,
      }}
      onMouseDown={canEdit ? handleMoveDown : undefined}
      /* Editors open via handleMoveDown's click-vs-drag detection; non-editors (viewer/
         commenter) can't drag, so a plain click opens the event read-only (to read/add comments). */
      onClick={canEdit ? undefined : () => onEdit(event.id)}
      onMouseEnter={e => onTooltip(event, e.clientX, e.clientY)}
      onMouseLeave={() => onTooltip(null)}
    >
      {canEdit && <div className="resize-handle left"  onMouseDown={e => handleResizeDown(e, 'left')} />}
      {canEdit && <div className="resize-handle right" onMouseDown={e => handleResizeDown(e, 'right')} />}

      {(event.percent_complete > 0) && (
        <div className="event-progress" style={{ width: event.percent_complete + '%', background: hexToRgba(color, 0.45) }} />
      )}

      <div className="event-inner">
        {nameFits && <span className="event-title">{event.title}</span>}
        <span className="event-time">{fmtSpan(startMs, endMs)}</span>
      </div>

      {event.task_count > 0 && onOpenTasks && (
        <button
          type="button"
          className={`event-tasks-badge${event.tasks_done === event.task_count ? ' all-done' : ''}`}
          title={`${event.tasks_done || 0}/${event.task_count} tasks done — click to open`}
          onMouseDown={e => e.stopPropagation()}
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
    </>
  )
}

export default memo(EventBlock)
