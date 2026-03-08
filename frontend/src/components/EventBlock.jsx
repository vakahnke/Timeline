import { useRef, useCallback, memo } from 'react'

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
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

function EventBlock({ event, rangeStart, pxPerHour, trackColor, trackColorMap, isCritical, snapMinutes, onUpdate, onEdit, onDelete, onTooltip }) {
  const blockRef = useRef(null)

  const color   = event.color || trackColor || '#4a88ff'
  const startMs = new Date(event.start).getTime()
  const endMs   = new Date(event.end).getTime()
  const x       = ((startMs - rangeStart) / 3_600_000) * pxPerHour
  const w       = Math.max(4, ((endMs - startMs) / 3_600_000) * pxPerHour)

  // ── Drag to move (horizontal + vertical track switching) ──────────────────
  const handleMoveDown = useCallback((e) => {
    if (e.button !== 0) return
    if (e.target.closest('.resize-handle') || e.target.closest('.event-actions')) return
    e.preventDefault()
    e.stopPropagation()

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
    let moved = false
    let activeLane = null

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

    const onMove = (e) => {
      const dx = e.clientX - mouseX0
      const dy = e.clientY - mouseY0
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      moved = true

      const dtMs = (dx / capPx) * 3_600_000
      const newS = snap(s0 + dtMs, capSnap)
      el.style.left = msToX(newS) + 'px'
      el.style.top  = (8 + dy) + 'px'
      if (timeEl) timeEl.textContent = `${fmtTime(newS)} – ${fmtTime(newS + dur)}`

      setActiveLane(getLaneAt(e.clientX, e.clientY))
    }

    const onUp = async (e) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      el.classList.remove('dragging')
      el.style.top = '8px'
      document.body.style.cursor = ''
      activeLane?.classList.remove('drag-over')

      if (!moved) return

      const dx = e.clientX - mouseX0
      const dtMs = (dx / capPx) * 3_600_000
      const newS = snap(s0 + dtMs, capSnap)

      const targetLane = getLaneAt(e.clientX, e.clientY)
      const newTrack = targetLane?.dataset.category ?? event.category
      const newColor = trackColorMap?.[newTrack] ?? event.color

      try {
        await onUpdate(event.id, {
          start: new Date(newS).toISOString(),
          end:   new Date(newS + dur).toISOString(),
          category: newTrack,
          color: newColor,
        })
      } catch {
        el.style.left = msToX(s0) + 'px'
        if (timeEl) timeEl.textContent = `${fmtTime(s0)} – ${fmtTime(e0)}`
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [event, pxPerHour, rangeStart, trackColorMap, onUpdate])

  // ── Resize handles ────────────────────────────────────────────────────────
  const handleResizeDown = useCallback((e, edge) => {
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
        if (timeEl) timeEl.textContent = `${fmtTime(newS)} – ${fmtTime(e0)}`
      } else {
        const newE = Math.max(snap(e0 + dtMs, capSnap), s0 + 300_000)
        el.style.width = Math.max(4, msToX(newE) - msToX(s0)) + 'px'
        if (timeEl) timeEl.textContent = `${fmtTime(s0)} – ${fmtTime(newE)}`
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
        if (timeEl) timeEl.textContent = `${fmtTime(s0)} – ${fmtTime(e0)}`
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [event, pxPerHour, rangeStart, onUpdate])

  return (
    <div
      ref={blockRef}
      className={`event-block${isCritical ? ' critical-path' : ''}`}
      style={{
        left:        x + 'px',
        width:       w + 'px',
        background:  hexToRgba(color, 0.22),
        borderColor: color,
      }}
      onMouseDown={handleMoveDown}
      onMouseEnter={e => onTooltip(event, e.clientX, e.clientY)}
      onMouseLeave={() => onTooltip(null)}
    >
      <div className="resize-handle left"  onMouseDown={e => handleResizeDown(e, 'left')} />
      <div className="resize-handle right" onMouseDown={e => handleResizeDown(e, 'right')} />

      {(event.percent_complete > 0) && (
        <div className="event-progress" style={{ width: event.percent_complete + '%', background: hexToRgba(color, 0.45) }} />
      )}

      <div className="event-inner">
        <span className="event-title">{event.title}</span>
        <span className="event-time">{fmtTime(startMs)} &ndash; {fmtTime(endMs)}</span>
      </div>

      <div className="event-actions">
        <button className="btn-edit" title="Edit" onClick={e => { e.stopPropagation(); onEdit(event.id) }}>&#9998;</button>
        <button className="btn-del"  title="Delete" onClick={e => { e.stopPropagation(); onDelete(event.id) }}>&#10005;</button>
      </div>
    </div>
  )
}

export default memo(EventBlock)
