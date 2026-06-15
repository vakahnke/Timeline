import { useState, useEffect, useRef } from 'react'

function fmtDT(ms) {
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    '  ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

function fmtDuration(ms) {
  const totalMin = Math.round(ms / 60_000)
  const days  = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins  = totalMin % 60
  const parts = []
  if (days)  parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (mins)  parts.push(`${mins}m`)
  return parts.join(' ') || '0m'
}

export default function Toolbar({ projectName, onBack, canEdit = true, isOwner = false, onOpenMembers, onSaveTemplate, pxPerHour, onZoomIn, onZoomOut, onFit, onNew, onNewCategory, settings, onSettingsChange, projectStart, projectEnd }) {
  const [showSettings, setShowSettings] = useState(false)
  const popoverRef = useRef(null)
  const gearRef    = useRef(null)

  const label = pxPerHour >= 1000
    ? `${Math.round(pxPerHour / 60)}px/min`
    : pxPerHour >= 1
      ? `${Math.round(pxPerHour)}px/hr`
      : `${(pxPerHour * 24).toFixed(1)}px/day`

  // Close popover on outside click
  useEffect(() => {
    if (!showSettings) return
    const onDown = (e) => {
      if (!popoverRef.current?.contains(e.target) && !gearRef.current?.contains(e.target))
        setShowSettings(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showSettings])

  return (
    <div className="toolbar">
      <button className="btn-back" onClick={onBack} title="Back to projects">←</button>
      <h1>{projectName || 'Timeline'}</h1>
      {!canEdit && <span className="ro-badge" title="You have view-only access">View only</span>}
      <div className="toolbar-sep" />
      <button onClick={onZoomOut} title="Zoom out  ·  −  or  Ctrl/⌘ + scroll">−</button>
      <span className="zoom-label" title="Drag to pan · Ctrl/⌘+scroll or pinch to zoom · arrows to move · 0 to fit">{label}</span>
      <button onClick={onZoomIn} title="Zoom in  ·  +  or  Ctrl/⌘ + scroll">+</button>
      <button onClick={onFit} title="Fit entire timeline  ·  0">Fit</button>
      <div className="toolbar-sep" />
      {projectStart != null && (
        <div className="toolbar-range">
          <span className="toolbar-range-item">
            <span className="toolbar-range-label">Start</span>
            <span className="toolbar-range-value">{fmtDT(projectStart)}</span>
          </span>
          <span className="toolbar-range-sep">–</span>
          <span className="toolbar-range-item">
            <span className="toolbar-range-label">Finish</span>
            <span className="toolbar-range-value">{fmtDT(projectEnd)}</span>
          </span>
          <span className="toolbar-range-sep">|</span>
          <span className="toolbar-range-item">
            <span className="toolbar-range-label">Duration</span>
            <span className="toolbar-range-value">{fmtDuration(projectEnd - projectStart)}</span>
          </span>
        </div>
      )}
      <div className="toolbar-spacer" />
      {isOwner && (
        <button className="btn-members" onClick={onOpenMembers} title="Manage members">Members</button>
      )}
      {canEdit && (
        <>
          <button className="btn-save-tpl" onClick={onSaveTemplate} title="Save this project as a reusable template">Save as Template</button>
          <button className="btn-new-cat" onClick={onNewCategory}>+ New Category</button>
          <button className="btn-new" onClick={onNew}>+ New Event</button>
        </>
      )}
      <div className="settings-wrap">
        <button
          ref={gearRef}
          className={`btn-gear${showSettings ? ' active' : ''}`}
          title="Settings"
          onClick={() => setShowSettings(s => !s)}
        >⚙</button>
        {showSettings && (
          <div className="settings-popover" ref={popoverRef}>
            <div className="settings-title">Settings</div>
            <label className="settings-row">
              <input
                type="checkbox"
                checked={settings.showArrows}
                onChange={e => onSettingsChange({ showArrows: e.target.checked })}
              />
              Show dependency arrows
            </label>
            <label className="settings-row">
              <input
                type="checkbox"
                checked={settings.showOnlyCritical}
                onChange={e => onSettingsChange({ showOnlyCritical: e.target.checked })}
              />
              Show critical path only
            </label>
            <div className="settings-row settings-row-select">
              <span>Snap to</span>
              <select
                value={settings.snapMinutes ?? 15}
                onChange={e => onSettingsChange({ snapMinutes: Number(e.target.value) })}
              >
                <option value={0}>None</option>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>60 min</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
