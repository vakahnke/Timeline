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

  // Draw the whole-project event overview onto the canvas. Positions mirror the MAIN
  // scroll content exactly (its pixel width = el.scrollWidth, which already accounts for
  // the Math.max(span×pxPerHour, clientWidth) clamp), so bars line up with the timeline
  // above them at every zoom level.
  drawRef.current = () => {
    const canvas = canvasRef.current, wrap = wrapRef.current, el = scrollRef.current
    if (!canvas || !wrap || !el || !range) return
    const W = wrap.clientWidth, H = MINI_H
    const mainW = el.scrollWidth || 1
    const dpr = window.devicePixelRatio || 1
    canvas.width  = Math.max(1, Math.round(W * dpr))
    canvas.height = Math.round(H * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const nTracks = Math.max(1, trackCount)
    const pad = 6
    const bandH = Math.max(2, Math.min(9, (H - pad * 2) / nTracks))
    const toX = ms => ((((ms - range.start) / 3_600_000) * pxPerHour) / mainW) * W
    for (const ev of events) {
      const x1 = toX(new Date(ev.start).getTime())
      const x2 = toX(new Date(ev.end).getTime())
      const ti = trackIndexMap[ev.category] ?? 0
      ctx.fillStyle = trackColorMap[ev.category] || ev.color || '#4a88ff'   // lane is authoritative
      ctx.fillRect(x1, pad + ti * bandH, Math.max(1.5, x2 - x1), Math.max(2, bandH - 1.5))
    }
  }

  // Position the viewport box over the slice currently visible in the main scroll. Uses
  // the same scrollWidth basis as the bars, so the box always frames the right elements.
  updateRef.current = () => {
    const el = scrollRef.current, wrap = wrapRef.current, vp = viewportRef.current
    if (!el || !wrap || !vp || !range) return
    const W = wrap.clientWidth
    const mainW = el.scrollWidth || 1
    const x = (el.scrollLeft / mainW) * W
    const w = (el.clientWidth / mainW) * W
    const clampedX = Math.max(0, Math.min(W, x))
    vp.style.left  = clampedX + 'px'
    vp.style.width = Math.max(6, Math.min(W - clampedX, w)) + 'px'
  }

  useLayoutEffect(() => { drawRef.current() }, [events, range, pxPerHour, trackColorMap, trackIndexMap, trackCount])
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
    el.scrollLeft = frac * el.scrollWidth - el.clientWidth / 2  // center the clicked spot
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
