import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from './api'
import { PALETTE } from './constants'
import Toolbar from './components/Toolbar'
import Timeline from './components/Timeline'
import EventModal from './components/EventModal'
import CategoryModal from './components/CategoryModal'

function buildTracks(events, apiCategories = [], prev = []) {
  const apiMap   = Object.fromEntries(apiCategories.map(c => [c.name, c.color]).filter(([, v]) => v))
  const apiIdMap = Object.fromEntries(apiCategories.map(c => [c.name, c.id]))

  // Derive color from events as fallback (first event's stored color per category)
  const evColorMap = {}
  for (const e of events) {
    if (!evColorMap[e.category] && e.color) evColorMap[e.category] = e.color
  }

  const allKnown = new Set([
    ...apiCategories.map(c => c.name),
    ...events.map(e => e.category),
  ])

  // Keep existing order, drop any that no longer exist, refresh id
  const result = prev
    .filter(t => allKnown.has(t.name))
    .map(t => ({ ...t, id: apiIdMap[t.name] ?? t.id ?? null }))
  const seen = new Set(result.map(t => t.name))

  // Append new API categories
  for (const c of apiCategories) {
    if (!seen.has(c.name)) {
      result.push({ id: c.id, name: c.name, color: c.color || evColorMap[c.name] || PALETTE[result.length % PALETTE.length] })
      seen.add(c.name)
    }
  }

  // Append event-derived categories not yet tracked
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

export default function App() {
  const [events,         setEvents]        = useState([])
  const [apiCategories,  setApiCategories] = useState([])
  const [tracks,         setTracks]        = useState([])
  const [range,          setRange]         = useState(null)
  const [pxPerHour,      setPxPerHour]     = useState(120)
  const [settings,       setSettings]      = useState({ showArrows: true, showOnlyCritical: false, snapMinutes: 15 })
  const [modal,          setModal]         = useState(null)
  const [catModal,       setCatModal]      = useState(null)  // { track }
  const [status,         setStatus]        = useState(null)
  const [loading,        setLoading]       = useState(true)
  const [apiError,       setApiError]      = useState(null)
  const timelineRef = useRef(null)
  const statusTimer = useRef(null)

  useEffect(() => {
    Promise.all([api.list(), api.categories.list()])
      .then(([evData, catData]) => {
        setEvents(evData)
        setRange(buildRange(evData))

        // Auto-create Category records for any event categories missing from the DB
        const catNames    = new Set(catData.map(c => c.name))
        const evColorMap  = {}
        for (const e of evData) {
          if (!evColorMap[e.category] && e.color) evColorMap[e.category] = e.color
        }
        const missing = [...new Set(evData.map(e => e.category))].filter(n => !catNames.has(n))
        if (missing.length) {
          Promise.all(
            missing.map((name, i) =>
              api.categories.create({ name, color: evColorMap[name] || PALETTE[(catData.length + i) % PALETTE.length] })
            )
          ).then(created => {
            setApiCategories([...catData, ...created])
          }).catch(() => setApiCategories(catData))
        } else {
          setApiCategories(catData)
        }
      })
      .catch(err => {
        console.error('API error:', err)
        setApiError('Could not reach API. Is Django running on :8000?')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    setTracks(prev => buildTracks(events, apiCategories, prev))
  }, [events, apiCategories])

  const flash = useCallback((msg, type) => {
    clearTimeout(statusTimer.current)
    setStatus({ msg, type })
    if (type !== 'saving') statusTimer.current = setTimeout(() => setStatus(null), 2000)
  }, [])

  const updateEvent = useCallback(async (id, patch) => {
    flash('Saving…', 'saving')
    const updated = await api.update(id, patch)
    setEvents(prev => prev.map(e => e.id === id ? updated : e))
    flash('Saved', 'saved')
    return updated
  }, [flash])

  const createEvent = useCallback(async (data) => {
    flash('Saving…', 'saving')
    const created = await api.create(data)
    setEvents(prev => {
      const next = [...prev, created]
      setRange(buildRange(next))
      return next
    })
    flash('Created', 'saved')
    return created
  }, [flash])

  const deleteEvent = useCallback(async (id) => {
    flash('Deleting…', 'saving')
    await api.remove(id)
    setEvents(prev => {
      const next = prev.filter(e => e.id !== id)
      if (next.length) setRange(buildRange(next))
      return next
    })
    flash('Deleted', 'saved')
  }, [flash])

  const openEditCategory = useCallback((track) => setCatModal({ track }), [])
  const closeCatModal    = useCallback(() => setCatModal(null), [])

  const saveCategory = useCallback(async (track, { name, color }) => {
    flash('Saving…', 'saving')
    try {
      if (track.id) {
        const updated = await api.categories.update(track.id, { name, color })
        setApiCategories(prev => prev.map(c => c.id === track.id ? updated : c))
      }

      // Patch all events in this category with new name/color
      const affected = events.filter(e => e.category === track.name)
      const patch = {}
      if (name !== track.name)   patch.category = name
      if (color !== track.color) patch.color    = color
      if (Object.keys(patch).length) {
        await Promise.all(affected.map(e => api.update(e.id, patch)))
        setEvents(prev => prev.map(e =>
          e.category === track.name ? { ...e, ...patch } : e
        ))
      }

      setTracks(prev => prev.map(t => t.name === track.name ? { ...t, name, color } : t))
      flash('Saved', 'saved')
    } catch (err) {
      flash('Error: ' + err.message, 'error')
    }
    closeCatModal()
  }, [events, flash, closeCatModal])

  const reorderTracks = useCallback((from, to) => {
    setTracks(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }, [])

  const openNew  = useCallback(defaults => setModal({ id: null, defaults: defaults ?? {} }), [])
  const openNewCategory = useCallback(async () => {
    const name = window.prompt('New category name:')
    if (!name?.trim()) return
    flash('Saving…', 'saving')
    try {
      const created = await api.categories.create({ name: name.trim(), color: PALETTE[tracks.length % PALETTE.length] })
      setApiCategories(prev => [...prev, created])
      flash('Category created', 'saved')
    } catch (err) {
      flash('Error: ' + err.message, 'error')
    }
  }, [tracks, flash])
  const openEdit = useCallback(id       => setModal({ id, defaults: null }), [])
  const closeModal = useCallback(() => setModal(null), [])

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

  return (
    <div className="app">
      <Toolbar
        pxPerHour={pxPerHour}
        setPxPerHour={setPxPerHour}
        onFit={() => timelineRef.current?.fitZoom()}
        onNew={() => openNew()}
        onNewCategory={openNewCategory}
        status={status}
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
          onSave={handleSave}
          onDelete={modal.id ? handleDelete : null}
          onClose={closeModal}
        />
      )}
    </div>
  )
}
