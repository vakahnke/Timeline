import { useState, useRef, useEffect } from 'react'

// A panel you can drag (by its header) and resize (bottom-right handle). Layout is
// persisted to localStorage per `storageKey` so it survives reloads.
export default function MovablePanel({
  storageKey, title, actions, children,
  defaultLayout, minWidth = 320, minHeight = 160, onLayoutChange,
}) {
  const [layout, setLayout] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey))
      if (saved && typeof saved.x === 'number') return saved
    } catch { /* ignore */ }
    return defaultLayout
  })
  const ref = useRef(null)

  // Keep the panel inside its container's width on mount (handles narrow screens / saved
  // layouts wider than the viewport).
  useEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    const maxW = parent.clientWidth
    setLayout(l => {
      const w = Math.min(l.w, maxW)
      const x = Math.min(l.x, Math.max(0, maxW - w))
      return (w === l.w && x === l.x) ? l : { ...l, w, x }
    })
  }, [])

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(layout)) } catch { /* ignore */ }
    onLayoutChange?.(layout)
  }, [layout]) // eslint-disable-line react-hooks/exhaustive-deps

  const drag = (e, mode) => {
    if (e.button !== 0) return
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY
    const { x, y, w, h } = layout
    const maxW = ref.current?.parentElement?.clientWidth ?? Infinity
    const onMove = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      if (mode === 'move') {
        setLayout(l => ({ ...l, x: Math.max(0, Math.min(x + dx, maxW - l.w)), y: Math.max(0, y + dy) }))
      } else {
        setLayout(l => ({ ...l, w: Math.max(minWidth, Math.min(w + dx, maxW - l.x)), h: Math.max(minHeight, h + dy) }))
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <section ref={ref} className="mpanel" style={{ left: layout.x, top: layout.y, width: layout.w, height: layout.h }}>
      <header className="mpanel-head" onPointerDown={e => drag(e, 'move')}>
        <span className="mpanel-title">{title}</span>
        {actions && <div className="mpanel-actions" onPointerDown={e => e.stopPropagation()}>{actions}</div>}
      </header>
      <div className="mpanel-body">{children}</div>
      <div className="mpanel-resize" onPointerDown={e => drag(e, 'resize')} title="Drag to resize" />
    </section>
  )
}
