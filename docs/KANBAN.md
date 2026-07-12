# Kanban Board View — Design Document

**Status:** DRAFT for review. All three research streams (UX, ordering, DnD library) folded in.
Awaiting sign-off before code.
**Last updated:** 2026-07-12
**Scope:** A third project view — a **Board** (Kanban) — alongside the existing Timeline and List views.

---

## 0. Goal

Add a **Board view** that shows a project's **tasks as cards in status columns**, so the team can
triage work by state and change a task's status by dragging its card between columns. It sits
beside Timeline and List as a third view of the same data.

**Headline finding:** because a card's column *is* the task's `status`, **v1 requires no backend
change and no migration** — dragging a card to a new column is the existing task-status PATCH.

---

## 1. Current state (grounding)

- **View toggle:** `ProjectTimeline` holds a `view` state (`'timeline' | 'list'`), persisted to
  `localStorage['timeline:view']`, defaulting to `list` on ≤720px. `Toolbar` renders the toggle
  buttons → `onViewChange`. Adding `'board'` = a third toggle button + a render branch.
- **Task model** (`backend/events/models.py`): `status ∈ {todo, in_progress, blocked, done}`,
  `order` (PositiveIntegerField), `assignee`, `due_date`, and an `event` FK. `Meta.ordering =
  ['order','id']`.
- **Data endpoint:** `GET /projects/{id}/tasks/` (`ProjectTasksView`, any member) already returns
  **every task in the project** with its `event {id,title,start,end}` and `project {id,name}` —
  exactly what a project-wide board needs. Frontend calls it via `api.tasks.byProject(pid)`.
- **Status change:** `PATCH /projects/{pid}/events/{eid}/tasks/{tid}/ {status}` already exists
  (`api.tasks.update`), gated Editor+. Each board card knows its `event.id`, so it can call this
  directly.
- **Stack:** React 18.3 + Vite, react-router. **No drag-and-drop library** — the timeline uses
  hand-rolled pointer-event handlers. Optimistic UI + REST PATCH throughout. Cross-platform
  (mouse, trackpad, **touch**) is a hard requirement.

---

## 2. Research summary

### 2.1 UX patterns (Trello, Jira, Asana, Linear, ClickUp, monday, GitHub Projects)

- Two schools: column-as-freeform-list (Trello) vs **column-maps-to-a-status/select-field**
  (Jira/Linear/GitHub) where **dragging a card writes the field**. Our fixed enum → the second
  model, with **four non-configurable columns**.
- **Blocked** is idiomatically a *flag*, not a column (a Blocked column loses workflow position,
  breaks WIP, gets forgotten). But our schema makes Blocked a status → v1 keeps a real Blocked
  column **styled as an alert** (amber/red), not a neutral stage. "Blocked as a boolean flag" is a
  later schema question.
- **Cards are deliberately sparse** (Linear drops overflow fields): title + assignee avatar +
  due-date chip (**red when overdue**) is the convergent minimum. Our highest-value extra is an
  **event chip** — the structural link no other tool has, and what keeps a flat project board legible.
- **Must-have interactions:** drag between columns (writes status), inline add, click-to-open.
  **Defer:** swimlanes (event-first when built), WIP limits, keyboard nav, quick-edit.
- **Touch:** keep the horizontal-scroll board (~300px columns, peeking edge, sticky headers, ≥44px
  targets) but add a **"Move to…" action sheet** (tap card → pick status) because cross-column drag
  is unreliable on touch.

### 2.2 Card ordering / persistence

- Manual drag-to-reorder *within* a column is a real problem: raw floats collapse after ~52
  splits; integer-gaps exhaust and need O(N) rebalances. The clean answer is **fractional-index
  string ranks** (LexoRank-style: one row per move, server computes the rank under a
  `select_for_update` lock, no precision ceiling). Gapped integers are a simpler second choice.
- **But v1 can skip manual reordering entirely** — order cards within a column by an automatic key
  (due date). That removes the rank field, the move endpoint, and the migration from v1.

### 2.3 DnD library

| Option | Maintenance / React 18 | Bundle (gz) | Touch | Keyboard/a11y | Verdict |
|---|---|---|---|---|---|
| **@dnd-kit** (core+sortable) | React 18/19 ✅; core 6.3.1 stable (frozen ~2yr, production-proven) | ~13KB | Good (tunable sensors) | **Built-in** (keyboard + ARIA) | ✅ **Recommended** |
| **@hello-pangea/dnd** | React 18 incl. StrictMode ✅ (rbd fork) | ~30KB+ | Excellent | Excellent | Runner-up; heaviest, 1-D only |
| **Pragmatic DnD** (Atlassian) | most active; powers Jira/Trello | ~4.7KB core | Caveated (native long-press only) | **Not built-in** (wire it up) | Smallest, but more work to hit our bar |
| **react-dnd** | core ~4yr stale; no sortable/a11y | large | needs touch-backend | none | ❌ |
| **Native HTML5 DnD** | zero-dep | 0 | **broken on touch** (needs polyfill) | none | ❌ |
| **Roll-your-own pointer events** | matches timeline, zero-dep | 0 | Good | **build it all yourself** | ❌ unless a11y is negotiable |

**Conclusion: `@dnd-kit`.** It's the only option that delivers **touch + keyboard/screen-reader
a11y + a sortable multi-column preset** together (the two hard-to-hand-roll parts — touch
scroll-vs-drag and keyboard/ARIA — come free), at ~13KB gz on a headless API that won't fight our
CSS, and it's **StrictMode-safe** (the exact thing that killed the original react-beautiful-dnd on
React 18). Maintenance caveat to accept knowingly: stable `@dnd-kit/core` **6.3.1 hasn't shipped a
release in ~2 years** and a rewritten `@dnd-kit/react` is still experimental (v0.x) — so **adopt
6.3.1 (used everywhere, proven), not the v0.x package.** Rolling our own (our instinct, matching the
timeline) is fine for pointer input but collapses on the a11y requirement — that's weeks of
keyboard/ARIA work dnd-kit already ships.

---

## 3. Proposed design

### 3.1 Where it lives

A third toolbar toggle: **Timeline · List · Board**. `view` state gains `'board'`; persisted the
same way. The Board renders the **project-wide** set of tasks (all events) grouped into status
columns. Data comes from the existing `api.tasks.byProject(projectId)` (no new endpoint).

### 3.2 Columns — four, fixed, status-mapped

`To do → In progress → Blocked → Done`, in that order (Blocked between In-progress and Done so Done
stays the right-most "complete" column). Not user-configurable (the enum is the source of truth).
**Blocked column is alert-styled** (amber accent + warning tint) so it reads as "needs attention."

### 3.3 Card content

Dense, ~2 lines: **task title**, **assignee avatar/name**, a **due-date chip that turns red when
overdue** (reuse the existing overdue logic), and a small **event chip** (`project's event title`).
Done cards are visually muted. Clicking a card **opens the existing task detail** (the task panel /
event's task manager), so no new detail UI is needed.

### 3.4 Board scope & the "new task needs an event" wrinkle

The board is **project-wide** (cards from every event, disambiguated by the event chip). One
consequence: a task can't exist without an event, so **inline "Add task" on the board must choose an
event**. **v1 decision:** *omit* inline-add on the board — tasks are still created in the timeline/
event task manager as today; the board is for triage and status. (Open question 6-B: add a simple
"+ Add" that prompts for an event, if wanted.)

### 3.5 Interactions

**v1 (must-have):**
- **Drag a card between columns** → `PATCH …/tasks/{id}/ {status}` (optimistic; rollback + toast on
  failure). Editors+ only; viewers/commenters get a read-only board.
- **Within a column, auto-sort** by **due date ascending (undated last), then event start, then
  `order`** — most-urgent first. No manual reordering in v1.
- **Touch: "Move to…" action sheet** — tap a card → pick a target status. Primary touch path; drag is
  a bonus where it works.
- **Click a card** → open its task detail (existing UI).
- **Empty columns** show a light placeholder (so an empty To-do/Blocked reads as intentional).
- **Filters:** assignee and "overdue only"; the board reuses the project task list, so filtering is
  client-side. A sort toggle (due date ↔ status-then-due) is optional.

**Deferred (v1.1 / v2):** manual within-column reordering (§3.8), swimlanes (by event first), WIP
limits, keyboard nav/multi-select, inline add-card, quick-edit-on-hover.

### 3.6 DnD approach — `@dnd-kit`

Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (~13KB gz). It covers **both** v1
cross-column drop and v1.1 within-column sort, so no hand-rolled drop zones/auto-scroll to throw
away. The "Move to…" action sheet (§3.5) still ships as the reliable touch path regardless.

Core pattern: a `DndContext` with sensors, a `SortableContext` per column, `useSortable` on cards,
`useDroppable` on columns (so **empty** Blocked/Done accept drops), and a `DragOverlay` floating card
(avoids reflow jank). On drop, compute source/dest column, update local state optimistically, then
`api.tasks.update(pid, card.event.id, card.id, {status})`; roll back + toast on failure.

**Gotchas (from the research) baked into the build:**
1. **Touch scroll-vs-drag** — the #1 mobile pitfall. Use sensor *activation constraints*
   (`PointerSensor {distance: 8}`, `TouchSensor {delay: 150, tolerance: 8}`) so a swipe scrolls and
   only a deliberate press-drag moves a card. Put `touch-action: none` **only on the drag handle**,
   never the scroll container.
2. **Nested auto-scroll** — the board scrolls horizontally while columns scroll vertically; verify
   the right ancestor is the scroll container and tune/disable dnd-kit's `autoScroll` as needed.
3. **`DragOverlay`** for the floating card; **`useDroppable` on empty columns**.
4. **Stable, namespaced ids** (`col:done` vs `card:42`), consistent id types, `SortableContext.items`
   derived from state (not a fresh literal), sensors wrapped in `useSensors` — the known footguns.
5. **StrictMode-safe** — dnd-kit is; keep it (don't reach for original react-beautiful-dnd).
6. Adopt **`@dnd-kit/core` 6.3.1**, not the experimental `@dnd-kit/react` v0.x.

### 3.7 Backend

**v1: none.** Status change = existing task PATCH; data = existing `ProjectTasksView`. No model
change, no migration, no new endpoint. This is a **frontend-only** feature for v1.

### 3.8 Manual within-column ordering (v1.1 — specced, deferred)

When we want drag-to-reorder inside a column (not just between columns):
- **Model:** add `rank = CharField(max_length=64, db_index=True)`; ordering `['rank','id']`; backfill
  per `(project, status)` group with fractional keys. Keep `order` for per-event task lists (the
  board's rank is a *separate*, project+status-scoped ordering, so it won't clash with the event
  task manager's `order`).
- **Endpoint:** `POST /projects/{pid}/tasks/{id}/move/ {status, after, before}` (neighbor task IDs,
  `null` at column ends). Server computes `rank = generate_key_between(after.rank, before.rank)`
  under `select_for_update`, sets `status`+`rank`, writes one row. (Project-level, since the board is
  project-wide — needs a project-scoped task action or a small new view.)
- **Frontend:** dnd-kit sortable; send neighbor IDs; optimistic with a client-side provisional key.
- **Rebalance:** effectively never; a cheap guard renumbers a column if any key exceeds ~50 chars.

### 3.9 Mobile / touch

Same horizontal-scroll board on all devices (one mental model): fixed ~300px columns, a peeking
next-column edge, sticky column headers, ≥44px targets. **"Move to…" action sheet** is the primary
touch path for changing status; drag works where the platform supports it.

---

## 4. Scope: v1 vs later

| | Included |
|---|---|
| **v1 (frontend-only)** | Board view + 3rd toggle; 4 fixed columns (Blocked alert-styled); dense cards (title/avatar/red-aware due chip/event chip); **drag between columns → status PATCH** (desktop) + **tap "Move to…"** (touch); within-column auto-sort by due date; click-to-open detail; empty-column placeholders; assignee + overdue filters. **No backend change, no migration.** |
| **v1.1** | Manual within-column reordering: `rank` field + `move` endpoint + fractional indexing + dnd-kit sortable (§3.8). One migration. |
| **v2** | Swimlanes (group by event, then assignee); WIP limits (informational); keyboard nav/multi-select; inline add-card (with event picker); Blocked-as-flag schema change. |

---

## 5. Implementation plan

**Phase A — v1 (frontend-only).**
1. `Board.jsx` — fetch `api.tasks.byProject`, group by status into 4 columns, render cards.
2. `BoardCard.jsx` — title, assignee, due chip (reuse overdue helper), event chip, muted-when-done.
3. Wire `@dnd-kit` (or roll-your-own, pending §3.6): drag card → optimistic status change →
   `api.tasks.update(pid, card.event.id, card.id, {status})`; rollback + toast on error.
4. Touch "Move to…" action sheet on card tap.
5. Toolbar: add the **Board** toggle; `ProjectTimeline`: `view === 'board'` branch; persist.
6. Filters (assignee, overdue), empty states, read-only for non-editors, CSS.
7. Verify (build + a browser drive on prod: drag a card, confirm status persists in Timeline/List).

**Phase B — v1.1 (when wanted).** `rank` migration + `move` endpoint + dnd-kit sortable + tests.

Each phase ships and is verifiable on its own; **Phase A alone is a complete, useful Board.**

---

## 6. Open questions for sign-off

- **A. DnD:** adopt `@dnd-kit` (recommended — only option with touch + keyboard/a11y + sortable,
  ~13KB, StrictMode-safe, future-proofs v1.1), or roll our own pointer-event drag for v1 to avoid a
  dependency (loses built-in a11y)?
- **B. Inline add on the board:** omit in v1 (recommended), or add a "+ Add" that prompts for an event?
- **C. Within-column sort key:** due date first (recommended), or keep each event's `order`, or by
  event start?
- **D. Manual reordering:** confirm it's deferred to v1.1 (recommended — v1 auto-sorts).
- **E. Board scope:** project-wide with event chips (recommended), vs a per-event board?
