import { tokens } from './auth/tokenStore'

const BASE = '/api'

// All nested-route building lives here -> switching route shapes is a one-place edit.
const url = {
  projects:   ()        => '/projects/',
  project:    (id)      => `/projects/${id}/`,
  events:     (pid)     => `/projects/${pid}/events/`,
  event:      (pid, id) => `/projects/${pid}/events/${id}/`,
  bulkEvents: (pid)     => `/projects/${pid}/events/bulk/`,
  categories: (pid)     => `/projects/${pid}/categories/`,
  category:   (pid, id) => `/projects/${pid}/categories/${id}/`,
  tasks:      (pid, eid)      => `/projects/${pid}/events/${eid}/tasks/`,
  task:       (pid, eid, tid) => `/projects/${pid}/events/${eid}/tasks/${tid}/`,
  comments:   (pid, eid)      => `/projects/${pid}/events/${eid}/comments/`,
  comment:    (pid, eid, cid) => `/projects/${pid}/events/${eid}/comments/${cid}/`,
  projectTasks: (pid)        => `/projects/${pid}/tasks/`,
  myTasks:    ()        => '/me/tasks/',
  members:    (pid)     => `/projects/${pid}/members/`,
  member:     (pid, id) => `/projects/${pid}/members/${id}/`,
  templates:  ()        => '/templates/',
  template:   (id)      => `/templates/${id}/`,
  instantiate:()        => '/templates/instantiate/',
  teams:       ()        => '/teams/',
  team:        (id)      => `/teams/${id}/`,
  teamMembers: (id)      => `/teams/${id}/members/`,
  teamMember:  (id, uid) => `/teams/${id}/members/${uid}/`,
  addTeam:      (pid)      => `/projects/${pid}/add-team/`,
  projectTeams: (pid)      => `/projects/${pid}/teams/`,
  projectTeam:  (pid, tid) => `/projects/${pid}/teams/${tid}/`,
  projectAccess:(pid)      => `/projects/${pid}/access/`,
  statusReports:(pid)      => `/projects/${pid}/status-reports/`,
  statusReport: (pid, id)  => `/projects/${pid}/status-reports/${id}/`,
  statusDraft:  (pid)      => `/projects/${pid}/status-reports/draft/`,
  baselines:    (pid)      => `/projects/${pid}/baselines/`,
}

export class ApiError extends Error {
  constructor(status, body) {
    super(`${status}: ${body}`)
    this.status = status
    this.body = body
  }
}

// Wired up by AuthProvider so the interceptor can force a logout + redirect.
let onAuthFailure = () => {}
export function setAuthFailureHandler(fn) { onAuthFailure = fn }

let refreshPromise = null  // single-flight guard: concurrent 401s share one refresh

async function rawFetch(path, opts = {}, withAuth = true) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (withAuth && tokens.access) headers.Authorization = `Bearer ${tokens.access}`
  return fetch(BASE + path, { ...opts, headers })
}

function doRefresh() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refresh = tokens.refresh
      if (!refresh) throw new Error('no-refresh')
      const res = await rawFetch('/auth/token/refresh/',
        { method: 'POST', body: JSON.stringify({ refresh }) }, false)
      if (!res.ok) throw new Error('refresh-failed')
      const data = await res.json()           // { access, refresh? }
      tokens.set({ access: data.access, refresh: data.refresh })
      return data.access
    })().finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

async function req(path, opts = {}, withAuth = true, _retried = false) {
  const res = await rawFetch(path, opts, withAuth)

  if (res.status === 401 && withAuth && !_retried && tokens.refresh) {
    try {
      await doRefresh()
      return req(path, opts, withAuth, true)   // retry exactly once
    } catch {
      tokens.clear()
      onAuthFailure()
      throw new ApiError(401, 'session expired')
    }
  }

  if (!res.ok) throw new ApiError(res.status, await res.text())
  if (res.status === 204) return null
  if (opts.blob) {                           // a file: hand back the bytes and the server's filename
    const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') || '')
    return { blob: await res.blob(), filename: name ? name[1] : null }
  }
  return res.json()
}

const body = (data) => JSON.stringify(data)

export const api = {
  auth: {
    register: (d)       => req('/auth/register/', { method: 'POST', body: body(d) }, false),
    login:    (d)       => req('/auth/token/',    { method: 'POST', body: body(d) }, false),
    logout:   (refresh) => req('/auth/logout/',   { method: 'POST', body: body({ refresh }) }, false),
    requestPasswordReset: (email) => req('/auth/password-reset/',         { method: 'POST', body: body({ email }) }, false),
    confirmPasswordReset: (d)     => req('/auth/password-reset/confirm/', { method: 'POST', body: body(d) }, false),
    me:       ()        => req('/me/'),
    myTasks:  (scope)   => req(url.myTasks() + (scope === 'all' ? '?scope=all' : '')),
  },

  users: {
    // Active-user directory for member/team pickers. Optional case-insensitive search.
    list: (search) => req('/users/' + (search ? '?search=' + encodeURIComponent(search) : '')),
  },

  projects: {
    list:   ()    => req(url.projects()),
    get:    (id)  => req(url.project(id)),
    create: (d)   => req(url.projects(), { method: 'POST', body: body(d) }),
    update: (id, d) => req(url.project(id), { method: 'PATCH', body: body(d) }),
    remove: (id)  => req(url.project(id), { method: 'DELETE' }),
    // File exports: each resolves to { blob, filename }.
    exportCalendar:  (id, only = 'all') => req(`/projects/${id}/calendar.ics${only === 'milestones' ? '?only=milestones' : ''}`, { blob: true }),
    exportMsProject: (id, tz)           => req(`/projects/${id}/export/msproject.xml${tz ? `?timezone=${encodeURIComponent(tz)}` : ''}`, { blob: true }),

    members: {
      list:       (pid)      => req(url.members(pid)),
      add:        (pid, d)   => req(url.members(pid), { method: 'POST', body: body(d) }),
      updateRole: (pid, mid, d) => req(url.member(pid, mid), { method: 'PATCH', body: body(d) }),
      remove:     (pid, mid) => req(url.member(pid, mid), { method: 'DELETE' }),
    },
    addTeam: (pid, d) => req(url.addTeam(pid), { method: 'POST', body: body(d) }),
    teams: {
      list:   (pid)          => req(url.projectTeams(pid)),
      remove: (pid, teamId)  => req(url.projectTeam(pid, teamId), { method: 'DELETE' }),
    },
    // Unified effective access (direct + team-derived + org-admin) with provenance.
    access: (pid) => req(url.projectAccess(pid)),
  },

  teams: {
    list:         ()        => req(url.teams()),
    get:          (id)      => req(url.team(id)),
    create:       (d)       => req(url.teams(), { method: 'POST', body: body(d) }),
    update:       (id, d)   => req(url.team(id), { method: 'PATCH', body: body(d) }),
    remove:       (id)      => req(url.team(id), { method: 'DELETE' }),
    addMember:    (id, d)   => req(url.teamMembers(id), { method: 'POST', body: body(d) }),
    removeMember: (id, uid) => req(url.teamMember(id, uid), { method: 'DELETE' }),
  },

  // Baselines: the plan, frozen, so a status report can show slip against it.
  baselines: {
    list:   (pid)       => req(url.baselines(pid)),
    create: (pid, name) => req(url.baselines(pid), { method: 'POST', body: body({ name }) }),
    remove: (pid, id)   => req(`${url.baselines(pid)}${id}/`, { method: 'DELETE' }),
  },

  // Status reports (the print tool): live draft from the schedule + saved, dated reports.
  statusReports: {
    draft:  (pid)        => req(url.statusDraft(pid)),
    list:   (pid)        => req(url.statusReports(pid)),
    get:    (pid, id)    => req(url.statusReport(pid, id)),
    create: (pid, d)     => req(url.statusReports(pid), { method: 'POST', body: body(d) }),
    update: (pid, id, d) => req(url.statusReport(pid, id), { method: 'PATCH', body: body(d) }),
    remove: (pid, id)    => req(url.statusReport(pid, id), { method: 'DELETE' }),
    exportPptx: (pid, d) => req(`${url.statusReports(pid)}export-pptx/`, { method: 'POST', body: body(d), blob: true }),
  },

  // Same method names as the old prototype, now project-scoped.
  events: {
    list:   (pid)        => req(url.events(pid)),
    create: (pid, d)     => req(url.events(pid),    { method: 'POST',  body: body(d) }),
    update: (pid, id, d) => req(url.event(pid, id), { method: 'PATCH', body: body(d) }),
    remove: (pid, id)    => req(url.event(pid, id), { method: 'DELETE' }),
    bulk:   (pid, list)  => req(url.bulkEvents(pid), { method: 'POST', body: body(list) }),
  },

  templates: {
    list:        ()   => req(url.templates()),
    instantiate: (d)  => req(url.instantiate(), { method: 'POST', body: body(d) }),
    save:        (d)  => req(url.templates(),   { method: 'POST', body: body(d) }),
    remove:      (id) => req(url.template(id),  { method: 'DELETE' }),
  },

  categories: {
    list:   (pid)        => req(url.categories(pid)),
    create: (pid, d)     => req(url.categories(pid),   { method: 'POST',  body: body(d) }),
    update: (pid, id, d) => req(url.category(pid, id), { method: 'PATCH', body: body(d) }),
    remove: (pid, id)    => req(url.category(pid, id), { method: 'DELETE' }),
  },

  tasks: {
    list:      (pid, eid)        => req(url.tasks(pid, eid)),
    create:    (pid, eid, d)     => req(url.tasks(pid, eid),     { method: 'POST',  body: body(d) }),
    update:    (pid, eid, id, d) => req(url.task(pid, eid, id),  { method: 'PATCH', body: body(d) }),
    remove:    (pid, eid, id)    => req(url.task(pid, eid, id),  { method: 'DELETE' }),
    byProject: (pid)             => req(url.projectTasks(pid)),
  },

  comments: {
    list:   (pid, eid)        => req(url.comments(pid, eid)),
    create: (pid, eid, d)     => req(url.comments(pid, eid),    { method: 'POST',  body: body(d) }),
    update: (pid, eid, id, d) => req(url.comment(pid, eid, id), { method: 'PATCH', body: body(d) }),
    remove: (pid, eid, id)    => req(url.comment(pid, eid, id), { method: 'DELETE' }),
  },
}
