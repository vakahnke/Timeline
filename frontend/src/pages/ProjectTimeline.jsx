import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../ui/ToastProvider'
import { PALETTE, MIN_PX_PER_HR, MAX_PX_PER_HR } from '../constants'
import Toolbar from '../components/Toolbar'
import Timeline from '../components/Timeline'
import EventList from '../components/EventList'
import EventModal from '../components/EventModal'
import EventTaskPanel from '../components/EventTaskPanel'
import CategoryModal from '../components/CategoryModal'
import MembersPanel from '../components/MembersPanel'
import WorkloadModal from '../components/WorkloadModal'
import ProjectStartModal from '../components/ProjectStartModal'

const DEFAULT_SETTINGS = { showArrows: true, showOnlyCritical: false, snapMinutes: 15, autoPanSpeed: 64 }

function buildTracks(events, apiCategories = [], prev = []) {
  const apiMap   = Object.fromEntries(apiCategories.map(c => [c.name, c.color]).filter(([, v]) => v))
  const apiIdMap = Object.fromEntries(apiCategories.map(c => [c.name, c.id]))

  const evColorMap = {}
  for (const e of events) {
    if (!evColorMap[e.category] && e.color) evColorMap[e.category] = e.color
  }

  const allKnown = new Set([
    ...apiCategories.map(c => c.name),
    ...events.map(e => e.category),
  ])

  const result = prev
    .filter(t => allKnown.has(t.name))
    .map(t => ({ ...t, id: apiIdMap[t.name] ?? t.id ?? null }))
  const seen = new Set(result.map(t => t.name))

  for (const c of apiCategories) {
    if (!seen.has(c.name)) {
      result.push({ id: c.id, name: c.name, color: c.color || evColorMap[c.name] || PALETTE[result.length % PALETTE.length] })
      seen.add(c.name)
    }
  }

  for (const e of events) {
    if (!seen.has(e.category)) {
      result.push({ id: apiIdMap[e.category] ?? null, name: e.category, color: apiMap[e.category] || evColorMap[e.category] || PALETTE[result.length % PALETTE.length] })
      seen.add(e.category)
    }
  }

  return result
}

function buildRange(events) {
  if (!events.length) return null
  const start = Math.min(...events.map(e => new Date(e.start).getTime()))
  const end   = Math.max(...events.map(e => new Date(e.end).getTime()))
  const pad   = (end - start) * 0.05
  return { start: start - pad, end: end + pad }
}

const DAY_MS = 86_400_000

// Shift a date-only 'YYYY-MM-DD' due date by whole days, staying date-only (no DST drift).
function addDaysToDue(due, days) {
  const d = new Date(due + 'T00:00:00')
  d.setDate(d.getDate() + days)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Shift a datetime by whole CALENDAR days, preserving local time-of-day across DST — so a
// reschedule lands the event on exactly the intended date (not an hour off near midnight).
function addDaysToISO(iso, days) {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

// A patch is a left/right MOVE only if start and end shift by the same amount. Resizes
// (one endpoint) and sub-day nudges return 0 days, so their tasks stay put.
function moveDeltaDays(cur, patch) {
  if (!cur || !patch.start || !patch.end) return 0
  const ds = new Date(patch.start).getTime() - new Date(cur.start).getTime()
  const de = new Date(patch.end).getTime()   - new Date(cur.end).getTime()
  if (ds !== de) return 0
  return Math.round(ds / DAY_MS)
}

export default function ProjectTimeline() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { flash } = useToast()
  const { user } = useAuth()

  const [project,        setProject]      = useState(null)
  const [members,        setMembers]      = useState([])
  const [events,         setEvents]       = useState([])
  const [apiCategories,  setApiCategories]= useState([])
  const [tracks,         setTracks]       = useState([])
  const [range,          setRange]        = useState(null)
  const [pxPerHour,      setPxPerHour]    = useState(120)
  const [settings,       setSettings]     = useState(() => {
    // Persisted per browser; merge over defaults so new keys still get a default.
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('timeline:settings') || '{}') } }
    catch { return { ...DEFAULT_SETTINGS } }
  })
  const [modal,          setModal]        = useState(null)
  const [taskPanelId,    setTaskPanelId]  = useState(null)  // event id whose task panel is open
  const [tasksReload,    setTasksReload]  = useState(0)     // bumped on task panel close
  // 'timeline' (pan/zoom) vs 'list' (mobile-friendly agenda). Defaults to list on a
  // phone-sized viewport; remembered per browser.
  const [view,           setView]         = useState(() => {
    try { const v = localStorage.getItem('timeline:view'); if (v === 'list' || v === 'timeline') return v } catch { /* ignore */ }
    return (typeof window !== 'undefined' && window.innerWidth <= 720) ? 'list' : 'timeline'
  })
  const [catModal,       setCatModal]     = useState(null)
  const [showMembers,    setShowMembers]  = useState(false)
  const [showWorkloads,  setShowWorkloads] = useState(false)
  const [showReschedule, setShowReschedule] = useState(false)
  const [loading,        setLoading]      = useState(true)
  const [apiError,       setApiError]     = useState(null)
  const [accessError,    setAccessError]  = useState(null)
  const timelineRef    = useRef(null)
  const didFitRef      = useRef(false)
  const pendingFrameRef = useRef(null)

  const role    = project?.my_role
  const canEdit = role === 'owner' || role === 'editor'
  const isOwner = role === 'owner'

  // Keep an event's task rollup (badge + tooltip) live as the panel edits tasks, without
  // refetching the event list. Returns the same array when nothing changed so the panel's
  // summary effect can't drive a render loop.
  const changeView = useCallback((v) => {
    setView(v)
    try { localStorage.setItem('timeline:view', v) } catch { /* ignore */ }
  }, [])

  const resetSettings = useCallback(() => {
    try { localStorage.setItem('timeline:settings', JSON.stringify(DEFAULT_SETTINGS)) } catch { /* ignore */ }
    setSettings({ ...DEFAULT_SETTINGS })
  }, [])

  const applyTaskSummary = useCallback((id, { total, done }) => {
    setEvents(prev => {
      const cur = prev.find(e => e.id === id)
      if (!cur || (cur.task_count === total && (cur.tasks_done || 0) === done)) return prev
      return prev.map(e => e.id === id ? { ...e, task_count: total, tasks_done: done } : e)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setAccessError(null)
    didFitRef.current = false  // re-fit when switching projects
    Promise.all([
      api.projects.get(projectId),
      api.events.list(projectId),
      api.categories.list(projectId),
    ])
      .then(([proj, evData, catData]) => {
        if (cancelled) return
        setProject(proj)
        setEvents(evData)
        const r = buildRange(evData)
        setRange(r)
        // Fit the initial zoom right away (approx viewport) so a long-span project never
        // first renders at the zoomed-in default — which would draw a huge ruler/canvas.
        if (r) {
          const spanHrs = (r.end - r.start) / 3_600_000
          const avail   = (window.innerWidth || 1200) - 180
          setPxPerHour(Math.max(MIN_PX_PER_HR, Math.min(MAX_PX_PER_HR, (avail / spanHrs) * 0.92)))
        }
        setApiCategories(catData)
        setApiError(null)
      })
      .catch(err => {
        if (cancelled) return
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          setAccessError('You don’t have access to this project.')
        } else {
          setApiError('Could not load this project. Is the API running?')
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    setTracks(prev => buildTracks(events, apiCategories, prev))
  }, [events, apiCategories])

  // Member list powers the task owner/assignee pickers. Non-fatal: a failure just
  // leaves the suggestion list empty (you can still type any email/username).
  useEffect(() => {
    let cancelled = false
    api.projects.members.list(projectId)
      .then(m => { if (!cancelled) setMembers(m) })
      .catch(() => { if (!cancelled) setMembers([]) })
    return () => { cancelled = true }
  }, [projectId])

  // Default view on first load: ~1-month zoom with today at the left edge.
  useEffect(() => {
    if (loading || !range || didFitRef.current) return
    didFitRef.current = true
    const from = new Date(); from.setHours(0, 0, 0, 0)         // start of today
    const to = new Date(from); to.setMonth(to.getMonth() + 1)  // one month out
    const fromMs = from.getTime(), toMs = to.getTime()
    const ev = buildRange(events)
    pendingFrameRef.current = { from: fromMs, to: toMs }       // framed by the layout effect once range updates
    setRange({
      start: Math.min(ev?.start ?? fromMs, fromMs),
      end:   Math.max(ev?.end ?? toMs, toMs),
    })
  }, [loading, range, events])

  // Today / this week / this month quick views. Extend the displayed range to reach the
  // period (so it's framable even if the project's events are elsewhere in time), then frame it.
  const viewPeriod = useCallback((period) => {
    const now = new Date()
    let from, to
    if (period === 'day') {
      from = new Date(now); from.setHours(0, 0, 0, 0)
      to = new Date(from); to.setDate(to.getDate() + 1)
    } else if (period === 'week') {
      from = new Date(now); from.setHours(0, 0, 0, 0)
      from.setDate(from.getDate() - ((from.getDay() + 6) % 7))  // Monday-start week
      to = new Date(from); to.setDate(to.getDate() + 7)
    } else {  // month
      from = new Date(now.getFullYear(), now.getMonth(), 1)
      to   = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    }
    const fromMs = from.getTime(), toMs = to.getTime()
    const ev = buildRange(events)
    pendingFrameRef.current = { from: fromMs, to: toMs }
    setRange({
      start: Math.min(ev?.start ?? fromMs, fromMs),
      end:   Math.max(ev?.end ?? toMs, toMs),
    })
  }, [events])

  useLayoutEffect(() => {
    const pf = pendingFrameRef.current
    if (!pf || !range) return
    pendingFrameRef.current = null
    const id = requestAnimationFrame(() => timelineRef.current?.frameWindow(pf.from, pf.to))
    return () => cancelAnimationFrame(id)
  }, [range])

  // Undo/redo for event edits. Each entry captures the changed fields before/after a
  // PATCH; undo/redo replay the inverse/forward patch via applyUpdate (no re-recording).
  const eventsRef = useRef(events)
  useEffect(() => { eventsRef.current = events }, [events])
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])
  useEffect(() => { setUndoStack([]); setRedoStack([]) }, [projectId])

  const applyUpdate = useCallback(async (id, patch) => {
    const updated = await api.events.update(projectId, id, patch)
    setEvents(prev => prev.map(e => e.id === id ? updated : e))
    return updated
  }, [projectId])

  const applyTaskUpdate = useCallback((eventId, taskId, patch) =>
    api.tasks.update(projectId, eventId, taskId, patch), [projectId])

  // Reschedule an event's tasks by the same whole-day shift as the drag. Returns undo
  // records ({eventId, taskId, before, after}) so the move stays reversible in one step.
  const shiftTasksForEvent = useCallback(async (eventId, days) => {
    if (!days) return []
    let tasks
    try { tasks = await api.tasks.list(projectId, eventId) }
    catch { return [] }   // best-effort: a failed fetch never blocks the event move
    const recs = tasks
      .filter(t => t.due_date)
      .map(t => ({ eventId, taskId: t.id,
                   before: { due_date: t.due_date },
                   after:  { due_date: addDaysToDue(t.due_date, days) } }))
    await Promise.all(recs.map(r => applyTaskUpdate(r.eventId, r.taskId, r.after)))
    if (recs.length) setTasksReload(n => n + 1)
    return recs
  }, [projectId, applyTaskUpdate])

  const updateEvent = useCallback(async (id, patch) => {
    const cur = eventsRef.current.find(e => e.id === id)
    // Snapshot only the fields this patch changes, so undo restores exactly those.
    const before = cur ? Object.fromEntries(Object.keys(patch).map(k => [k, cur[k]])) : null
    const days = moveDeltaDays(cur, patch)   // capture BEFORE the move updates eventsRef
    flash('Saving…', 'saving')
    try {
      const updated = await applyUpdate(id, patch)
      const tasks = (days && cur?.task_count > 0) ? await shiftTasksForEvent(id, days) : []
      if (before) {
        setUndoStack(s => [...s, { id, before, after: patch, tasks: tasks.length ? tasks : undefined }])
        setRedoStack([])  // a fresh edit invalidates the redo branch
      }
      flash('Saved', 'saved')
      return updated
    } catch (err) {
      flash(err.status === 403 ? 'You don’t have edit access.' : 'Save failed.', 'error')
      throw err
    }
  }, [applyUpdate, shiftTasksForEvent, flash])

  // Move several events as one undoable step (used by the multi-select group drag).
  // updates: [{ id, patch }].
  // opts.taskDays overrides the inferred per-event day-shift (used by a whole-project
  // reschedule, where every event's tasks move by the same known amount).
  const moveEvents = useCallback(async (updates, opts = {}) => {
    if (!updates || !updates.length) return
    // Capture cur + the whole-day shift up front, before applyUpdate mutates eventsRef.
    const items = updates.map(({ id, patch }) => {
      const cur = eventsRef.current.find(e => e.id === id)
      return cur ? { id, patch, cur, days: opts.taskDays ?? moveDeltaDays(cur, patch),
                     before: Object.fromEntries(Object.keys(patch).map(k => [k, cur[k]])) } : null
    }).filter(Boolean)
    flash('Saving…', 'saving')
    try {
      await Promise.all(items.map(it => applyUpdate(it.id, it.patch)))
      const taskLists = await Promise.all(items.map(it =>
        (it.days && it.cur.task_count > 0) ? shiftTasksForEvent(it.id, it.days) : Promise.resolve([])))
      const group = items.map(({ id, before, patch }) => ({ id, before, after: patch }))
      const tasks = taskLists.flat()
      if (group.length) { setUndoStack(s => [...s, { group, tasks: tasks.length ? tasks : undefined }]); setRedoStack([]) }
      flash('Saved', 'saved')
    } catch (err) {
      flash(err.status === 403 ? 'You don’t have edit access.' : 'Save failed.', 'error')
      throw err
    }
  }, [applyUpdate, shiftTasksForEvent, flash])

  // Reschedule the whole project: shift every event (and its task due dates) by the same
  // whole-day delta, as one undoable step. Reuses moveEvents so tasks follow automatically.
  const rescheduleProject = useCallback(async (days) => {
    if (!days) return
    const snapshot = eventsRef.current.slice()   // capture BEFORE the move shifts eventsRef
    const updates = snapshot.map(ev => ({
      id: ev.id,
      patch: { start: addDaysToISO(ev.start, days), end: addDaysToISO(ev.end, days) },
    }))
    await moveEvents(updates, { taskDays: days })
    // Keep the shifted project in view: frame a ~1-month window at the new start.
    const oldStart = Math.min(...snapshot.map(e => new Date(e.start).getTime()))
    const oldEnd   = Math.max(...snapshot.map(e => new Date(e.end).getTime()))
    const newStart = Math.min(...snapshot.map(e => new Date(addDaysToISO(e.start, days)).getTime()))
    const newEnd   = Math.max(...snapshot.map(e => new Date(addDaysToISO(e.end,   days)).getTime()))
    const frameTo  = new Date(newStart); frameTo.setMonth(frameTo.getMonth() + 1)
    pendingFrameRef.current = { from: newStart, to: frameTo.getTime() }
    // Range spans both old and new extents so undo can't strand events off-screen.
    setRange({ start: Math.min(oldStart, newStart), end: Math.max(oldEnd, newEnd, frameTo.getTime()) })
  }, [moveEvents])

  const undo = useCallback(async () => {
    const entry = undoStack[undoStack.length - 1]
    if (!entry) return
    flash('Undoing…', 'saving')
    try {
      if (entry.group) await Promise.all(entry.group.map(g => applyUpdate(g.id, g.before)))
      else await applyUpdate(entry.id, entry.before)
      if (entry.tasks) {
        await Promise.all(entry.tasks.map(t => applyTaskUpdate(t.eventId, t.taskId, t.before)))
        setTasksReload(n => n + 1)
      }
      setUndoStack(s => s.slice(0, -1))
      setRedoStack(s => [...s, entry])
      flash('Undone', 'saved')
    } catch (err) {
      flash(err.status === 403 ? 'You don’t have edit access.'
            : err.status === 404 ? 'That event no longer exists.' : 'Undo failed.', 'error')
    }
  }, [undoStack, applyUpdate, applyTaskUpdate, flash])

  const redo = useCallback(async () => {
    const entry = redoStack[redoStack.length - 1]
    if (!entry) return
    flash('Redoing…', 'saving')
    try {
      if (entry.group) await Promise.all(entry.group.map(g => applyUpdate(g.id, g.after)))
      else await applyUpdate(entry.id, entry.after)
      if (entry.tasks) {
        await Promise.all(entry.tasks.map(t => applyTaskUpdate(t.eventId, t.taskId, t.after)))
        setTasksReload(n => n + 1)
      }
      setRedoStack(s => s.slice(0, -1))
      setUndoStack(s => [...s, entry])
      flash('Redone', 'saved')
    } catch (err) {
      flash(err.status === 403 ? 'You don’t have edit access.'
            : err.status === 404 ? 'That event no longer exists.' : 'Redo failed.', 'error')
    }
  }, [redoStack, applyUpdate, applyTaskUpdate, flash])

  // Ctrl/⌘+Z = undo, Ctrl/⌘+Shift+Z or Ctrl/⌘+Y = redo. Stay out of the way when a
  // modal is open or a form field is focused (let native text undo work there).
  useEffect(() => {
    if (!canEdit) return
    const onKey = (e) => {
      if (modal || catModal || showMembers) return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey)      { e.preventDefault(); undo() }
      else if (k === 'z' || k === 'y')   { e.preventDefault(); redo() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [canEdit, modal, catModal, showMembers, undo, redo])

  const createEvent = useCallback(async (data) => {
    flash('Saving…', 'saving')
    const created = await api.events.create(projectId, data)
    setEvents(prev => {
      const next = [...prev, created]
      setRange(buildRange(next))
      return next
    })
    flash('Created', 'saved')
    return created
  }, [projectId, flash])

  const deleteEvent = useCallback(async (id) => {
    flash('Deleting…', 'saving')
    await api.events.remove(projectId, id)
    setEvents(prev => {
      const next = prev.filter(e => e.id !== id)
      if (next.length) setRange(buildRange(next))
      return next
    })
    // Drop history that points at the now-deleted event so undo can't 404.
    const refsDeleted = (h) => h.group ? h.group.some(g => g.id === id) : h.id === id
    setUndoStack(s => s.filter(h => !refsDeleted(h)))
    setRedoStack(s => s.filter(h => !refsDeleted(h)))
    flash('Deleted', 'saved')
  }, [projectId, flash])

  const openEditCategory = useCallback((track) => setCatModal({ track }), [])
  const closeCatModal    = useCallback(() => setCatModal(null), [])

  const saveCategory = useCallback(async (track, { name, color }) => {
    flash('Saving…', 'saving')
    try {
      if (track.id) {
        const updated = await api.categories.update(projectId, track.id, { name, color })
        setApiCategories(prev => prev.map(c => c.id === track.id ? updated : c))
      }
      const affected = events.filter(e => e.category === track.name)
      const patch = {}
      if (name !== track.name)   patch.category = name
      if (color !== track.color) patch.color    = color
      if (Object.keys(patch).length) {
        await Promise.all(affected.map(e => api.events.update(projectId, e.id, patch)))
        setEvents(prev => prev.map(e => e.category === track.name ? { ...e, ...patch } : e))
      }
      setTracks(prev => prev.map(t => t.name === track.name ? { ...t, name, color } : t))
      flash('Saved', 'saved')
    } catch (err) {
      flash('Error: ' + err.message, 'error')
    }
    closeCatModal()
  }, [projectId, events, flash, closeCatModal])

  const reorderTracks = useCallback((from, to) => {
    setTracks(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }, [])

  const openNew = useCallback(defaults => setModal({ id: null, defaults: defaults ?? {} }), [])
  const openNewCategory = useCallback(async () => {
    const name = window.prompt('New category name:')
    if (!name?.trim()) return
    flash('Saving…', 'saving')
    try {
      const created = await api.categories.create(projectId, { name: name.trim(), color: PALETTE[tracks.length % PALETTE.length] })
      setApiCategories(prev => [...prev, created])
      flash('Category created', 'saved')
    } catch (err) {
      flash('Error: ' + err.message, 'error')
    }
  }, [projectId, tracks, flash])

  const openEdit   = useCallback(id => setModal({ id, defaults: null }), [])
  const closeModal = useCallback(() => setModal(null), [])

  const saveAsTemplate = useCallback(async () => {
    const tplName = window.prompt('Save this project as a template named:', project?.name || 'My Template')
    if (!tplName?.trim()) return
    flash('Saving template…', 'saving')
    try {
      await api.templates.save({ project: Number(projectId), name: tplName.trim() })
      flash('Template saved', 'saved')
    } catch (err) {
      flash('Error: ' + err.message, 'error')
    }
  }, [projectId, project, flash])

  // Successors are stored as the OTHER event's depends_on, so after saving this event we
  // add/remove its id on each successor. Recorded as one group step so it undoes cleanly.
  const reconcileSuccessors = useCallback(async (thisId, desiredIds) => {
    const want = new Set(desiredIds)
    const group = []
    for (const e of eventsRef.current) {
      if (e.id === thisId) continue
      const deps = e.depends_on ?? []
      const has  = deps.includes(thisId)
      if (has === want.has(e.id)) continue        // already in the desired state
      const next = has ? deps.filter(id => id !== thisId) : [...deps, thisId]
      group.push({ id: e.id, before: { depends_on: deps }, after: { depends_on: next } })
    }
    if (!group.length) return
    await Promise.all(group.map(g => applyUpdate(g.id, g.after)))
    setUndoStack(s => [...s, { group }])
    setRedoStack([])
  }, [applyUpdate])

  const handleSave = useCallback(async (data) => {
    const { _successors, ...fields } = data
    const categoryColor = tracks.find(t => t.name === fields.category)?.color ?? ''
    const payload = { ...fields, color: categoryColor }
    const saved = modal.id ? await updateEvent(modal.id, payload) : await createEvent(payload)
    if (_successors) await reconcileSuccessors(saved.id, _successors)
    closeModal()
  }, [modal, tracks, updateEvent, createEvent, reconcileSuccessors, closeModal])

  const handleDelete = useCallback(async () => {
    await deleteEvent(modal.id)
    closeModal()
  }, [modal, deleteEvent, closeModal])

  if (accessError) {
    return (
      <div className="centered-page">
        <div className="message-card">
          <h1>Access denied</h1>
          <p>{accessError}</p>
          <button className="btn-primary" onClick={() => navigate('/')}>Back to projects</button>
        </div>
      </div>
    )
  }

  const projectStart = events.length ? Math.min(...events.map(e => new Date(e.start).getTime())) : null
  const projectEnd   = events.length ? Math.max(...events.map(e => new Date(e.end).getTime()))   : null

  return (
    <div className="app">
      <Toolbar
        projectName={project?.name}
        onBack={() => navigate('/')}
        canEdit={canEdit}
        isOwner={isOwner}
        view={view}
        onViewChange={changeView}
        onUndo={undo}
        onRedo={redo}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onOpenMembers={() => setShowMembers(true)}
        onManageWorkloads={() => setShowWorkloads(true)}
        onSaveTemplate={saveAsTemplate}
        pxPerHour={pxPerHour}
        onZoomIn={() => timelineRef.current?.zoomBy(1.6)}
        onZoomOut={() => timelineRef.current?.zoomBy(1 / 1.6)}
        onFit={() => timelineRef.current?.fitZoom()}
        onViewPeriod={viewPeriod}
        onNew={() => openNew()}
        onNewCategory={openNewCategory}
        settings={settings}
        onSettingsChange={s => setSettings(prev => {
          const next = { ...prev, ...s }
          try { localStorage.setItem('timeline:settings', JSON.stringify(next)) } catch { /* ignore */ }
          return next
        })}
        onResetSettings={resetSettings}
        projectStart={projectStart}
        projectEnd={projectEnd}
        onEditStart={() => setShowReschedule(true)}
      />
      {view === 'list' ? (
        <EventList
          projectId={projectId}
          events={events}
          tracks={tracks}
          canEdit={canEdit}
          reloadToken={tasksReload}
          onOpenEdit={openEdit}
          onOpenTasks={(id) => setTaskPanelId(id)}
          onOpenNew={openNew}
        />
      ) : (
        <Timeline
          ref={timelineRef}
          events={events}
          tracks={tracks}
          range={range}
          pxPerHour={pxPerHour}
          setPxPerHour={setPxPerHour}
          settings={settings}
          canEdit={canEdit}
          onReorderTracks={reorderTracks}
          onEditCategory={openEditCategory}
          onUpdateEvent={updateEvent}
          onOpenEdit={openEdit}
          onOpenNew={openNew}
          onDeleteEvent={deleteEvent}
          onOpenTasks={(id) => setTaskPanelId(id)}
          onMoveEvents={moveEvents}
          loading={loading}
          apiError={apiError}
        />
      )}
      {catModal && (
        <CategoryModal
          track={catModal.track}
          readOnly={!canEdit}
          onSave={saveCategory}
          onClose={closeCatModal}
        />
      )}
      {modal && (
        <EventModal
          eventId={modal.id}
          defaults={modal.defaults}
          events={events}
          tracks={tracks}
          projectId={projectId}
          readOnly={!canEdit}
          tasksReloadToken={tasksReload}
          onManageTasks={(id) => { closeModal(); setTaskPanelId(id) }}
          onSave={handleSave}
          onDelete={modal.id && canEdit ? handleDelete : null}
          onClose={closeModal}
        />
      )}
      {taskPanelId != null && events.find(e => e.id === taskPanelId) && (
        <EventTaskPanel
          projectId={projectId}
          event={events.find(e => e.id === taskPanelId)}
          members={members}
          currentUser={user}
          readOnly={!canEdit}
          onSummaryChange={applyTaskSummary}
          onClose={() => { setTaskPanelId(null); setTasksReload(n => n + 1) }}
        />
      )}
      {showMembers && (
        <MembersPanel
          projectId={projectId}
          isOwner={isOwner}
          onClose={() => setShowMembers(false)}
        />
      )}
      {showWorkloads && (
        <WorkloadModal
          projectId={projectId}
          projectName={project?.name}
          members={members}
          canEdit={canEdit}
          onClose={() => setShowWorkloads(false)}
        />
      )}
      {showReschedule && projectStart != null && (
        <ProjectStartModal
          currentStart={projectStart}
          currentEnd={projectEnd}
          eventCount={events.length}
          onApply={async (days) => { await rescheduleProject(days); setShowReschedule(false) }}
          onClose={() => setShowReschedule(false)}
        />
      )}
    </div>
  )
}
