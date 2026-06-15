import { useRef, useEffect, useLayoutEffect } from 'react'

const MINI_H = 56  // keep in sync with .minimap height in style.css

// A compact overview of the whole project. Events are drawn as small bars (by track,
// colored by category); a viewport box shows the slice currently on screen. Click or
// drag anywhere on the strip to jump the main timeline there.
export default function Minimap({ scrollRef, range, pxPerHour, events, trackColorMap, trackIndexMap, trackCount }) {
  const wrapRef     = useRef(null)
  const canvasRef   = useRef(null)
  const viewportRef = useRef(null)
  const drawRef     = useRef(() => {})
  const updateRef   = useRef(() => {})

  // Draw the whole-project event overview onto the canvas.
  drawRef.current = () => {
    const canvas = canvasRef.current, wrap = wrapRef.current
    if (!canvas || !wrap || !range) return
    const W = wrap.clientWidth, H = MINI_H
    const dpr = window.devicePixelRatio || 1
    canvas.width  = Math.max(1, Math.round(W * dpr))
    canvas.height = Math.round(H * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const span = (range.end - range.start) || 1
    const nTracks = Math.max(1, trackCount)
    const pad = 6
    const bandH = Math.max(2, Math.min(9, (H - pad * 2) / nTracks))
    for (const ev of events) {
      const s = new Date(ev.start).getTime(), e = new Date(ev.end).getTime()
      const x1 = ((s - range.start) / span) * W
      const x2 = ((e - range.start) / span) * W
      const ti = trackIndexMap[ev.category] ?? 0
      ctx.fillStyle = ev.color || trackColorMap[ev.category] || '#4a88ff'
      ctx.fillRect(x1, pad + ti * bandH, Math.max(1.5, x2 - x1), Math.max(2, bandH - 1.5))
    }
  }

  // Position the viewport box over the slice that's currently visible in the main scroll.
  updateRef.current = () => {
    const el = scrollRef.current, wrap = wrapRef.current, vp = viewportRef.current
    if (!el || !wrap || !vp || !range) return
    const span = (range.end - range.start) || 1
    const W = wrap.clientWidth
    const visStart = range.start + (el.scrollLeft / pxPerHour) * 3_600_000
    const visEnd   = range.start + ((el.scrollLeft + el.clientWidth) / pxPerHour) * 3_600_000
    const x = ((visStart - range.start) / span) * W
    const w = ((visEnd - visStart) / span) * W
    const clampedX = Math.max(0, Math.min(W, x))
    vp.style.left  = clampedX + 'px'
    vp.style.width = Math.max(6, Math.min(W - clampedX, w)) + 'px'
  }

  useLayoutEffect(() => { drawRef.current() }, [events, range, trackColorMap, trackIndexMap, trackCount])
  useLayoutEffect(() => { updateRef.current() })  // runs each render -> stays synced with zoom

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => updateRef.current()
    el.addEventListener('scroll', onScroll, { passive: true })
    const onResize = () => { drawRef.current(); updateRef.current() }
    window.addEventListener('resize', onResize)
    return () => { el.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize) }
  }, [scrollRef])

  const navTo = (clientX) => {
    const el = scrollRef.current, wrap = wrapRef.current
    if (!el || !wrap || !range) return
    const rect = wrap.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / wrap.clientWidth))
    const timeMs = range.start + frac * (range.end - range.start)
    const targetX = ((timeMs - range.start) / 3_600_000) * pxPerHour
    el.scrollLeft = targetX - el.clientWidth / 2  // center the clicked time
  }

  const onDown = (e) => {
    e.preventDefault()
    navTo(e.clientX)
    const move = (m) => navTo(m.clientX)
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  if (!range || !events.length) return null
  return (
    <div className="minimap" ref={wrapRef} onMouseDown={onDown} title="Overview — click or drag to navigate">
      <canvas ref={canvasRef} className="minimap-canvas" />
      <div className="minimap-viewport" ref={viewportRef} />
    </div>
  )
}
