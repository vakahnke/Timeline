# Microsoft Project XML Import and Export — Design Document

**Status:** Draft
**Last updated:** 2026-09-19
**Scope:** Read and write Microsoft Project's XML interchange format (MSPDI) so a schedule can move between Timeline and Microsoft Project, and the other tools that speak the same format. A new import flow that creates a project, a new export endpoint, and an honest report of what did not survive the trip.

---

## 0. Problem / motivating requirements

Many organizations hold their official schedule in Microsoft Project. A PM who prefers to plan in
Timeline cannot start from that schedule, and cannot hand a Timeline plan back to a scheduler
who needs it in Project.

- **R1. Import.** Open a schedule saved from Microsoft Project and get a usable Timeline project:
  tracks, events with the right dates, progress, milestones and dependencies.
- **R2. Export.** Hand a Timeline project to someone using Microsoft Project, and have it open
  there **with the same dates**.
- **R3. Honest about loss.** The two tools do not model the same things. Every import and export
  says plainly what was dropped or approximated. Nothing is lost silently.
- **R4. Safe.** An uploaded file is untrusted input. It cannot read server files, exhaust memory,
  or touch any existing project.
- **R5 (later).** Re-import a newer version of the same file and update, rather than duplicate.

Not in scope: the binary `.mpp` format (undocumented; the user does File ▸ Save As ▸ XML in
Project), resources and cost, working calendars, live sync, Project Online / Project for the web APIs.

## 1. Current state (grounding)

What Timeline can hold, which bounds what any import can keep (`backend/events/models.py`):

- **`Event`**: `title` (200 chars), `start`/`end` as timezone-aware datetimes with
  `end > start` enforced (`EventSerializer.validate`), `category` (free text, the **track**),
  `color`, `notes`, `percent_complete`, `is_milestone`, and `depends_on`.
- **Dependencies are finish-to-start only, with no lag.** `depends_on` is a plain many-to-many
  to other events of the same project. There are no link types and no lag field.
- **One level of grouping.** An event belongs to one track (`category`). There is no outline or
  work-breakdown hierarchy.
- **No calendars and no resources.** Durations are wall-clock. People appear only as `Task`
  owners and assignees inside an event; a `Task` has a status and an optional `due_date`, no dates
  of its own.
- **Cycles are not rejected on the server today.** `EventSerializer.validate` checks only that
  dependencies are in the same project; the client prevents cycles in the editor. An importer must
  check for itself (and this is worth fixing generally).
- **A project factory exists.** `create_project_from_spec` (`backend/projects/templates.py`) builds
  a project, its categories, events and dependencies in one go for templates. Import is the same
  job with absolute dates instead of offsets, so it should share that code path.
- **Downloads exist** (the blob path in `frontend/src/api.js` from the PowerPoint export). **Uploads
  do not**: no endpoint accepts a file yet. nginx already caps request bodies at 10 MB
  (`nginx/nginx.prod.conf`).
- `lxml` is already installed (it came with `python-pptx`), but it is not safe for untrusted XML
  by default.

## 2. Prior art / research

*Drafted from the published MSPDI schema and working knowledge of the tools, not from fresh tests
against Microsoft Project. Phase 1 must confirm the behaviours below with real files.*

- **The format.** MSPDI is one XML document, root `<Project xmlns="http://schemas.microsoft.com/project">`,
  with `<Tasks>`, `<Resources>`, `<Assignments>` and `<Calendars>`. A `<Task>` carries `UID`
  (stable identity), `ID` (row number), `Name`, `OutlineLevel` and `OutlineNumber` (the hierarchy,
  flattened into a list), `Start`, `Finish`, `Duration` (ISO 8601, e.g. `PT40H0M0S`, in **working**
  time), `PercentComplete`, `Milestone`, `Summary`, `Notes`, `ConstraintType`/`ConstraintDate`,
  `Manual`, and zero or more `<PredecessorLink>` with `PredecessorUID`, `Type`
  (0 finish-finish, 1 finish-start, 2 start-finish, 3 start-start) and `LinkLag` in tenths of a minute.
  The task with `UID` 0 is the project summary row, not real work.
- **Dates carry no time zone.** `2026-11-06T17:00:00` means "in whatever zone the author's PC was
  in". An importer has to be told, or has to guess.
- **Project recalculates on open.** Unless a task is manually scheduled (`<Manual>1</Manual>`) or
  pinned by a constraint, Project recomputes `Start`/`Finish` from predecessors, durations and the
  project calendar (8-hour days, weekends off). A naive export therefore opens with **different
  dates** than Timeline showed: the core difficulty of R2.
- **Who else reads it.** ProjectLibre, GanttProject, Smartsheet, OpenProject, Primavera P6 and
  Merlin import MSPDI, and the MPXJ library (LGPL, Java/.NET/Python wrapper) reads and writes it
  along with `.mpp`. MSPDI is the de facto interchange format for schedules, so this feature is
  really "import from and export to most scheduling tools".
- **What other importers do with the mismatch.** Tools with a flatter model (Smartsheet,
  TeamGantt, Asana) flatten the outline to one or two levels, keep finish-to-start links, drop or
  approximate the rest, and show a summary afterwards. None of them fail the import over it.
- **XML from strangers is dangerous.** Entity expansion ("billion laughs"), external entities
  reading local files (XXE), and external DTD fetches are the standard attacks. `defusedxml`
  (PSF license, pure Python) exists to switch all of that off.

## 3. Proposed design

### 3.1 Mapping

| Microsoft Project | Timeline | Notes |
|---|---|---|
| Project `Name` / `Title` | project name | editable in the import dialog |
| Summary task at outline level 1 | **track** (`category`) | gets the next palette colour |
| Leaf task (not a summary) | **event** | under its level-1 ancestor's track |
| Leaf task at level 1 (no parent) | event in track "General" | |
| Deeper summary tasks (level 2+) | flattened; name kept as a prefix in `notes` ("In: Design ▸ Wireframes") | reported as approximated |
| `Start`, `Finish` | `start`, `end` | interpreted in the time zone chosen in the dialog |
| `Milestone` = 1, or zero duration | `is_milestone`, with `end = start + 1 hour` | Timeline requires `end > start` |
| `PercentComplete` | `percent_complete` | |
| `Notes` | `notes` | |
| `PredecessorLink` type 1 (finish-start), no lag | `depends_on` | exact |
| Any other link type, or any lag | `depends_on`, **flagged** | the link is kept, its type and lag are dropped and listed |
| Link to or from a summary task | moved to that summary's first or last leaf, **flagged** | |
| Resources, assignments, cost, calendars, constraints, baselines, custom fields | dropped, **counted** in the report | |
| Task `UID` | kept in a new `Event.external_ref` | phase 2 only, for re-import |

Export is the reverse: each track becomes a level-1 summary task, each event a level-2 task with
`Start`, `Finish`, `PercentComplete`, `Milestone`, `Notes`, and one finish-to-start
`PredecessorLink` per `depends_on`. `Task` rows (the to-do items inside an event) are written
into the task's `Notes` as a checklist in phase 1.

**Keeping the dates on export (R2).** Every exported task is marked manually scheduled
(`<Manual>1</Manual>`, with `ManualStart`/`ManualFinish`/`ManualDuration`), and the file carries a
24-hour, 7-day project calendar so durations equal wall-clock time. Project then shows Timeline's
dates untouched, with the dependency arrows drawn, and the scheduler can switch tasks to
auto-scheduling when they choose to take over. The alternative, "must start on" constraints on
every task, fills Project with constraint warnings and is rejected.

### 3.2 API

- `POST /api/projects/import/msproject/` (multipart: `file`, `timezone`, optional `name`,
  `dry_run`). Any signed-in user; the importer becomes Owner of the **new** project.
  - `dry_run=1` parses and returns only the report: counts of tracks, events, links, and the
    list of everything that would be dropped or approximated. Nothing is written.
  - Otherwise creates the project in one transaction and returns `{project, report}`.
  - Import **never** writes into an existing project in phase 1.
- `GET /api/projects/<id>/export/msproject.xml?timezone=America/New_York` — any member. Returns
  `application/xml` as an attachment, plus an `X-Timeline-Export-Notes` summary the UI shows.

### 3.3 Limits and safety (R4)

- Parsed with `defusedxml` (entities, external references and DTDs all refused), never with a
  default `lxml` parser.
- 10 MB file cap (already enforced by nginx; enforced again in the view), 5,000 tasks, 20,000 links.
  Over the cap: a clear error, not a truncated import.
- Titles truncated to 200 characters, percent clamped to 0–100, `end` forced after `start`,
  dates outside 1990–2100 rejected as corrupt.
- Dependency cycles (legal in a broken file, fatal to the critical-path code) are detected and
  the offending links dropped and reported.
- Throttled per user, because parsing is the most expensive request the API would accept.

### 3.4 UI / UX

- **Import:** "Import from Microsoft Project" beside "New from template" on the projects
  dashboard. Choose the file, confirm the time zone (pre-filled from the browser), and see the
  dry-run report *before* anything is created: "142 tasks → 9 tracks, 118 events, 131 links.
  12 links had lag or a type Timeline does not have; they were kept as simple dependencies.
  37 resources and 2 calendars were not imported." Then **Create project**.
- **Export:** "Export to Microsoft Project (.xml)" in the gear menu, next to the calendar export,
  with a one-line note on what Project will and will not receive.

### 3.5 Permissions impact

Import creates a project, which any account may already do. Export is a read, open to any member
like the other exports. No new roles.

## 4. Alternatives considered

- **Read `.mpp` directly via MPXJ.** Would spare users the Save As step, but it means running a
  JVM beside Django (or a Java-bridged Python wheel of ~100 MB) and taking an LGPL dependency
  into an Apache-2.0 project. Rejected; revisit only if Save As proves to be a real barrier.
- **Extend the data model first** (link types, lag, outline levels, calendars) so less is lost.
  Each of those reaches into the timeline canvas, the critical-path code and the editor. That is
  several features, not a precondition. Import what fits now; let real files show which gap hurts.
- **Import into an existing project / merge.** The matching problem (which task is which event)
  is the hard part of R5 and has no good answer without stored UIDs. Deferred to phase 2.
- **Parse in the browser.** Keeps untrusted XML off the server, but export must be server-side for
  scripts and the two halves would duplicate the mapping. Rejected.
- **CSV instead.** Simpler, but it cannot carry dependencies in any standard way, and dependencies
  are the point of a schedule.
- **Auto-scheduled export with a standard calendar.** The most "native" result in Project, but the
  dates change on open unless Timeline's durations are converted to working time, which needs the
  calendar model Timeline does not have. Rejected in favour of manual scheduling (3.1).

## 5. Phasing

- **Phase 1: export.** The smaller half and useful alone: hand a Timeline plan to a scheduler.
  Builder, endpoint, gear-menu item, tests against the MSPDI schema, and a manual check that the
  file opens in Microsoft Project and ProjectLibre with identical dates.
- **Phase 2: import as a new project.** Safe parser, mapping, dry-run report, import dialog,
  limits, cycle detection. Tested with files saved from Project, ProjectLibre and GanttProject,
  plus hostile files (entity bombs, XXE, cycles, 50,000 tasks).
- **Phase 3: round trip.** `Event.external_ref` stores the source `UID`; re-importing a newer file
  into the project it created shows a diff (moved, added, removed) and applies it on confirmation.
- **Later / maybe:** link types and lag as first-class data; outline levels; resources mapped to
  members; Primavera P6 XML (XER's successor) through the same mapping layer.

## 6. Cost & risk

- **Effort:** Phase 1 **S–M**. Phase 2 **M–L** (first upload endpoint, the report UI, the hostile-file
  tests). Phase 3 **L** (diff and merge UI, one additive migration).
- **Migration / data risk:** Phases 1–2 none: export is read-only and import only ever creates a
  new project inside one transaction. Phase 3 adds one nullable column.
- **Perf / UX risk:** a 5,000-task import creates 5,000 events; the canvas timeline is built for
  hundreds. Bulk-create on the server, and test the timeline at that size before raising the cap.
- **Security risk:** the highest of any feature so far, because it is the first to accept a file.
  Mitigated by `defusedxml`, hard caps, throttling, and never touching existing data.
- **Fidelity risk:** users will expect more to survive than the model can hold. The dry-run report
  exists to set that expectation *before* the project is created.
- **Verification risk:** correctness can only be proven by opening files in Microsoft Project
  itself, which needs a Windows machine or a tester with a licence. ProjectLibre (free,
  cross-platform) covers most of it but not Project's recalculation behaviour.
- **Blast radius:** new endpoints and two menu entries. No existing behaviour changes.
- **Dependency:** `defusedxml` (PSF-2.0), compatible with Apache-2.0.

## 7. Open questions / decisions needed

- [ ] **Which direction matters to you first?** Proposed: export, because it is smaller and safer.
      If the real need is "start from the official schedule", import should lead.
- [ ] **Can someone open test files in real Microsoft Project?** Without that, R2 is unproven.
- [ ] **Milestone length on import:** one hour (proposed), or a full day so it is visible when
      zoomed out?
- [ ] **Deep outlines:** flatten to the level-1 track (proposed), or use the *lowest* summary as
      the track, which gives many small tracks?
- [ ] **Time zone on import:** ask every time (proposed), or remember per user?
- [ ] **Is the server-side cycle check worth adding to the normal event API too?** It is a gap
      today regardless of this feature.
