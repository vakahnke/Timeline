import { useState, useEffect, useRef } from 'react'
import { BRAND } from '../constants'

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

export default function Toolbar({ projectName, onBack, canEdit = true, isOwner = false, view = 'timeline', onViewChange, onUndo, onRedo, canUndo = false, canRedo = false, onOpenMembers, onManageWorkloads, onStatusReport, onExport, onCloseout, closedOut = false, onSaveTemplate, pxPerHour, onZoomIn, onZoomOut, onFit, onViewPeriod, onNew, onNewCategory, settings, onSettingsChange, onResetSettings, projectStart, projectEnd, onEditStart }) {
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
      <h1>{projectName || BRAND}</h1>
      {!canEdit && <span className="ro-badge" title="You have view-only access">View only</span>}
      {closedOut && (
        <button className="closed-badge" onClick={onCloseout} title="This project has been closed out. Open to see the answers.">Closed out</button>
      )}
      {/* Phones: forces a line break so row 1 = back/title/undo/gear, row 2 = views/zoom/new. */}
      <div className="tb-break" aria-hidden="true" />
      <div className="view-toggle" role="group" aria-label="View mode">
        <button className={`view-toggle-btn${view === 'timeline' ? ' active' : ''}`}
                onClick={() => onViewChange?.('timeline')} title="Timeline view">Timeline</button>
        <button className={`view-toggle-btn${view === 'list' ? ' active' : ''}`}
                onClick={() => onViewChange?.('list')} title="List view (agenda)">List</button>
        <button className={`view-toggle-btn${view === 'board' ? ' active' : ''}`}
                onClick={() => onViewChange?.('board')} title="Board view (Kanban by status)">Board</button>
        {/* Compact layouts hide the "Status report" button, which left the report buried at the
            bottom of the gear menu. It is a fourth way of looking at the project, so it lives here. */}
        <button className="view-toggle-btn view-toggle-report" onClick={onStatusReport}
                title="One-page status report for leadership">Report</button>
      </div>
      {view === 'timeline' && (
        <>
          <div className="toolbar-sep" />
          <button className="tb-zoom tb-zoom-step" onClick={onZoomOut} title="Zoom out  ·  −  or  Ctrl/⌘ + scroll">−</button>
          <span className="zoom-label tb-desktop" title="Drag to pan · Ctrl/⌘+scroll or pinch to zoom · arrows to move · 0 to fit">{label}</span>
          <button className="tb-zoom tb-zoom-step" onClick={onZoomIn} title="Zoom in  ·  +  or  Ctrl/⌘ + scroll">+</button>
          <button className="tb-zoom" onClick={onFit} title="Fit entire timeline  ·  0">Fit</button>
          <button className="tb-collapsible" onClick={() => onViewPeriod?.('day')}   title="Frame today">Today</button>
          <button className="tb-collapsible" onClick={() => onViewPeriod?.('week')}  title="Frame this week">Week</button>
          <button className="tb-collapsible" onClick={() => onViewPeriod?.('month')} title="Frame this month">Month</button>
        </>
      )}
      {canEdit && (
        <>
          <div className="toolbar-sep" />
          <button className="tb-undo" onClick={onUndo} disabled={!canUndo} title="Undo  ·  Ctrl/⌘ + Z">↶</button>
          <button className="tb-undo" onClick={onRedo} disabled={!canRedo} title="Redo  ·  Ctrl/⌘ + Shift + Z">↷</button>
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
        <button className="btn-members tb-collapsible" onClick={onOpenMembers} title="Manage members">Members</button>
      )}
      <button className="btn-workloads tb-collapsible" onClick={onManageWorkloads} title="View workload by member and reassign tasks">Manage Workloads</button>
      <button className="btn-report tb-collapsible" onClick={onStatusReport} title="One-page status report for leadership: customize it and print or save as PDF">Status report</button>
      <button className="btn-report tb-collapsible" onClick={onExport} title="Download a calendar file (.ics) or Microsoft Project XML">Export</button>
      {canEdit && (
        <>
          <button className="btn-save-tpl tb-collapsible" onClick={onSaveTemplate} title="Save this project as a reusable template">Save as Template</button>
          <button className="btn-new-cat tb-collapsible" onClick={onNewCategory}>+ New Category</button>
          <button className="btn-new" onClick={onNew} title="New event">
            <span className="tb-desktop">+ New Event</span><span className="tb-phone">+ Event</span>
          </button>
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

            {/* Always here, on every screen: the toolbar has no button for it. Owners close a run out
                (also one that stopped early); anyone can read a close-out once there is one. */}
            {(isOwner || closedOut) && (
              <>
                <div className="settings-title">When it is over</div>
                <button className="settings-action" onClick={() => { onCloseout?.(); setShowSettings(false) }}
                        title="What it cost and how the plan worked">{closedOut ? 'Close-out…' : 'Close out…'}</button>
              </>
            )}

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
              <div className="settings-title">Project</div>
              {canEdit && (
                <button className="settings-action" onClick={() => { onNewCategory?.(); setShowSettings(false) }}>+ New category</button>
              )}
              {isOwner && (
                <button className="settings-action" onClick={() => { onOpenMembers?.(); setShowSettings(false) }}>Members</button>
              )}
              <button className="settings-action" onClick={() => { onManageWorkloads?.(); setShowSettings(false) }}>Manage workloads</button>
              <button className="settings-action" onClick={() => { onStatusReport?.(); setShowSettings(false) }}>Status report</button>
              <button className="settings-action" onClick={() => { onExport?.(); setShowSettings(false) }}>Export…</button>
              {canEdit && (
                <>
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
