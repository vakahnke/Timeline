import { useRef, useEffect } from 'react'

const ZOOM_MIN = 0.6, ZOOM_MAX = 1.8, ZOOM_STEP = 0.1
const clampZoom = z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10))

// A controlled panel you can drag (by its header), resize (bottom-right handle), and
// zoom (content scale). The parent owns `layout` ({ x, y, w, h, zoom }) and persists it.
//
// `docked` (phones): render as an ordinary full-width section in document flow — no
// dragging, resizing or zoom. Free-floating windows don't fit a 390px screen, and the
// saved desktop layout is left untouched for when the same account is used on a laptop.
export default function MovablePanel({ title, actions, children, layout, onChange, minWidth = 300, minHeight = 180, docked = false }) {
  const ref = useRef(null)
  const zoom = layout.zoom ?? 1

  // Keep the panel within its container's width on mount (narrow screens / stale layouts).
  useEffect(() => {
    if (docked) return
    const maxW = ref.current?.parentElement?.clientWidth
    if (!maxW) return
    if (layout.w > maxW || layout.x + layout.w > maxW) {
      const w = Math.min(layout.w, maxW)
      onChange({ ...layout, w, x: Math.min(layout.x, Math.max(0, maxW - w)) })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const drag = (e, mode) => {
    if (e.button !== 0) return
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY
    const base = layout
    const maxW = ref.current?.parentElement?.clientWidth ?? Infinity
    const onMove = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      if (mode === 'move') {
        onChange({ ...base, x: Math.max(0, Math.min(base.x + dx, maxW - base.w)), y: Math.max(0, base.y + dy) })
      } else {
        onChange({ ...base, w: Math.max(minWidth, Math.min(base.w + dx, maxW - base.x)), h: Math.max(minHeight, base.h + dy) })
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const setZoom = z => onChange({ ...layout, zoom: clampZoom(z) })

  if (docked) {
    return (
      <section ref={ref} className="mpanel mpanel--docked">
        <header className="mpanel-head">
          <span className="mpanel-title">{title}</span>
          <div className="mpanel-actions">{actions}</div>
        </header>
        <div className="mpanel-body">{children}</div>
      </section>
    )
  }

  return (
    <section ref={ref} className="mpanel" style={{ left: layout.x, top: layout.y, width: layout.w, height: layout.h }}>
      <header className="mpanel-head" onPointerDown={e => drag(e, 'move')}>
        <span className="mpanel-title">{title}</span>
        <div className="mpanel-actions" onPointerDown={e => e.stopPropagation()}>
          {actions}
          <div className="mpanel-zoom" title="Zoom this window">
            <button type="button" className="btn-icon btn-icon--sm" onClick={() => setZoom(zoom - ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}>&minus;</button>
            <button type="button" className="btn-icon btn-icon--sm zoom-val" onClick={() => setZoom(1)} title="Reset zoom to 100%">{Math.round(zoom * 100)}%</button>
            <button type="button" className="btn-icon btn-icon--sm" onClick={() => setZoom(zoom + ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}>+</button>
          </div>
        </div>
      </header>
      <div className="mpanel-body" style={{ zoom }}>{children}</div>
      <div className="mpanel-resize" onPointerDown={e => drag(e, 'resize')} title="Drag to resize" />
    </section>
  )
}
