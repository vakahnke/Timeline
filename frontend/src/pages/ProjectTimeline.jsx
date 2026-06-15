import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useToast } from '../ui/ToastProvider'
import { PALETTE } from '../constants'
import Toolbar from '../components/Toolbar'
import Timeline from '../components/Timeline'
import EventModal from '../components/EventModal'
import CategoryModal from '../components/CategoryModal'
import MembersPanel from '../components/MembersPanel'

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

export default function ProjectTimeline() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { flash } = useToast()

  const [project,        setProject]      = useState(null)
  const [events,         setEvents]       = useState([])
  const [apiCategories,  setApiCategories]= useState([])
  const [tracks,         setTracks]       = useState([])
  const [range,          setRange]        = useState(null)
  const [pxPerHour,      setPxPerHour]    = useState(120)
  const [settings,       setSettings]     = useState({ showArrows: true, showOnlyCritical: false, snapMinutes: 15 })
  const [modal,          setModal]        = useState(null)
  const [catModal,       setCatModal]     = useState(null)
  const [showMembers,    setShowMembers]  = useState(false)
  const [loading,        setLoading]      = useState(true)
  const [apiError,       setApiError]     = useState(null)
  const [accessError,    setAccessError]  = useState(null)
  const timelineRef = useRef(null)
  const didFitRef   = useRef(false)

  const role    = project?.my_role
  const canEdit = role === 'owner' || role === 'editor'
  const isOwner = role === 'owner'

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
        setRange(buildRange(evData))
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

  // Auto-fit the zoom once on first load so events are visible regardless of span.
  useEffect(() => {
    if (loading || !range || didFitRef.current) return
    didFitRef.current = true
    const id = requestAnimationFrame(() => timelineRef.current?.fitZoom())
    return () => cancelAnimationFrame(id)
  }, [loading, range])

  const updateEvent = useCallback(async (id, patch) => {
    flash('Saving…', 'saving')
    try {
      const updated = await api.events.update(projectId, id, patch)
      setEvents(prev => prev.map(e => e.id === id ? updated : e))
      flash('Saved', 'saved')
      return updated
    } catch (err) {
      flash(err.status === 403 ? 'You don’t have edit access.' : 'Save failed.', 'error')
      throw err
    }
  }, [projectId, flash])

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

  const handleSave = useCallback(async (data) => {
    const categoryColor = tracks.find(t => t.name === data.category)?.color ?? ''
    const payload = { ...data, color: categoryColor }
    if (modal.id) await updateEvent(modal.id, payload)
    else          await createEvent(payload)
    closeModal()
  }, [modal, tracks, updateEvent, createEvent, closeModal])

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

  return (
    <div className="app">
      <Toolbar
        projectName={project?.name}
        onBack={() => navigate('/')}
        canEdit={canEdit}
        isOwner={isOwner}
        onOpenMembers={() => setShowMembers(true)}
        onSaveTemplate={saveAsTemplate}
        pxPerHour={pxPerHour}
        setPxPerHour={setPxPerHour}
        onFit={() => timelineRef.current?.fitZoom()}
        onNew={() => openNew()}
        onNewCategory={openNewCategory}
        settings={settings}
        onSettingsChange={s => setSettings(prev => ({ ...prev, ...s }))}
        projectStart={events.length ? Math.min(...events.map(e => new Date(e.start).getTime())) : null}
        projectEnd={events.length   ? Math.max(...events.map(e => new Date(e.end).getTime()))   : null}
      />
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
        loading={loading}
        apiError={apiError}
      />
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
          readOnly={!canEdit}
          onSave={handleSave}
          onDelete={modal.id && canEdit ? handleDelete : null}
          onClose={closeModal}
        />
      )}
      {showMembers && (
        <MembersPanel
          projectId={projectId}
          isOwner={isOwner}
          onClose={() => setShowMembers(false)}
        />
      )}
    </div>
  )
}
