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

export default function Toolbar({ projectName, onBack, canEdit = true, isOwner = false, view = 'timeline', onViewChange, onUndo, onRedo, canUndo = false, canRedo = false, onOpenMembers, onManageWorkloads, onSaveTemplate, pxPerHour, onZoomIn, onZoomOut, onFit, onViewPeriod, onNew, onNewCategory, settings, onSettingsChange, onResetSettings, projectStart, projectEnd, onEditStart }) {
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
      <div className="view-toggle" role="group" aria-label="View mode">
        <button className={`view-toggle-btn${view === 'timeline' ? ' active' : ''}`}
                onClick={() => onViewChange?.('timeline')} title="Timeline view">Timeline</button>
        <button className={`view-toggle-btn${view === 'list' ? ' active' : ''}`}
                onClick={() => onViewChange?.('list')} title="List view (best on phones)">List</button>
        <button className={`view-toggle-btn${view === 'board' ? ' active' : ''}`}
                onClick={() => onViewChange?.('board')} title="Board view (Kanban by status)">Board</button>
      </div>
      {view === 'timeline' && (
        <>
          <div className="toolbar-sep" />
          <button onClick={onZoomOut} title="Zoom out  ·  −  or  Ctrl/⌘ + scroll">−</button>
          <span className="zoom-label" title="Drag to pan · Ctrl/⌘+scroll or pinch to zoom · arrows to move · 0 to fit">{label}</span>
          <button onClick={onZoomIn} title="Zoom in  ·  +  or  Ctrl/⌘ + scroll">+</button>
          <button onClick={onFit} title="Fit entire timeline  ·  0">Fit</button>
          <button className="tb-collapsible" onClick={() => onViewPeriod?.('day')}   title="Frame today">Today</button>
          <button className="tb-collapsible" onClick={() => onViewPeriod?.('week')}  title="Frame this week">Week</button>
          <button className="tb-collapsible" onClick={() => onViewPeriod?.('month')} title="Frame this month">Month</button>
        </>
      )}
      {canEdit && (
        <>
          <div className="toolbar-sep" />
          <button onClick={onUndo} disabled={!canUndo} title="Undo  ·  Ctrl/⌘ + Z">↶</button>
          <button onClick={onRedo} disabled={!canRedo} title="Redo  ·  Ctrl/⌘ + Shift + Z">↷</button>
        </>
      )}
      <div className="toolbar-sep" />
      {projectStart != null && (
        <div className="toolbar-range">
          <span className="toolbar-range-item">
            <span className="toolbar-range-label">Start</span>
            {canEdit ? (
              <button
                className="toolbar-range-value toolbar-range-edit"
                onClick={onEditStart}
                title="Change the start date — shifts every event and its tasks"
              >{fmtDT(projectStart)} ✎</button>
            ) : (
              <span className="toolbar-range-value">{fmtDT(projectStart)}</span>
            )}
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
      <button className="btn-workloads" onClick={onManageWorkloads} title="View workload by member and reassign tasks">Manage Workloads</button>
      {canEdit && (
        <>
          <button className="btn-save-tpl tb-collapsible" onClick={onSaveTemplate} title="Save this project as a reusable template">Save as Template</button>
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
            <div className="settings-row settings-row-select">
              <span>Drag pan speed</span>
              <input
                type="range"
                className="settings-range"
                min="20" max="200" step="4"
                value={settings.autoPanSpeed ?? 64}
                onChange={e => onSettingsChange({ autoPanSpeed: Number(e.target.value) })}
                title={`Auto-pan speed when dragging an event to the edge: ${settings.autoPanSpeed ?? 64} px/frame`}
              />
            </div>

            {/* On phones the toolbar hides these (tb-collapsible); surface them here instead. */}
            <div className="settings-mobile">
              {view === 'timeline' && (
                <>
                  <div className="settings-title">Frame</div>
                  <button className="settings-action" onClick={() => { onViewPeriod?.('day');   setShowSettings(false) }}>Today</button>
                  <button className="settings-action" onClick={() => { onViewPeriod?.('week');  setShowSettings(false) }}>This week</button>
                  <button className="settings-action" onClick={() => { onViewPeriod?.('month'); setShowSettings(false) }}>This month</button>
                </>
              )}
              {canEdit && (
                <>
                  <div className="settings-title">Project</div>
                  <button className="settings-action" onClick={() => { onEditStart?.(); setShowSettings(false) }}>Change start date</button>
                  <button className="settings-action" onClick={() => { onSaveTemplate?.(); setShowSettings(false) }}>Save as Template</button>
                </>
              )}
            </div>
            <button className="settings-reset" onClick={() => onResetSettings?.()}>Reset to defaults</button>
          </div>
        )}
      </div>
    </div>
  )
}
