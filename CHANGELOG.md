# Changelog

Notable changes to Timeline. The format follows [Keep a Changelog](https://keepachangelog.com/),
and versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-09-19

The first tagged release. Everything below is in it.

### Planning
- A canvas-drawn Gantt timeline: drag to pan, Ctrl/⌘-drag to move an event, drag an edge to
  resize, smooth zoom from months to minutes, a minimap, dependency arrows, and the critical path
  highlighted automatically. Undo and redo for every change.
- Three views of one plan: Timeline, List, and a Board that groups tasks by status.
- Events with notes, percent complete, key-milestone flag, predecessors and successors, sub-tasks
  with owners and due dates, and a comment thread. The API refuses dependency loops.
- Project templates: 21 built-ins for business, engineering and hobby projects, plus your own
  saved templates, instantiated at a start date you choose.
- Works on a phone: drag to pan, pinch to zoom, press and hold to move an event, grab dots to
  resize. The layout survives rotation.

### Status report
- A one-page status report filled in from the schedule: a status derived by rule with the rule
  printed, a drafted headline, the decision you need, five numbers against a reference, a
  simplified timeline, what finished, what is next, and the top risks. Click any text to reword it.
- Print or save as a PDF (16:9 slide, or a Letter/A4 handout), or download a native, fully
  editable PowerPoint file.
- Optional, per report: slip against a frozen baseline, "what moved since last report", and a
  milestone trend chart. Per-project limits for At risk and Off track.
- On a phone: a Report tab, the slide shown whole, and a readable version below it.

### Working with other tools
- Export to iCalendar (`.ics`) for Outlook, Google Calendar and Apple Calendar.
- Export to Microsoft Project XML, validated against Microsoft's published schema.
- A documented REST API (OpenAPI, Swagger and ReDoc) behind everything the app does.

### Teams and access
- Private projects with four roles (viewer, commenter, editor, owner), teams that grant access to
  a whole group at once, and a workload view across members.
- Authorization is decided on the server from the caller's current membership, never from anything
  the client sends, with an adversarial test suite to keep it that way.
- Password reset by email, account approval for new sign-ups, and a people directory that only
  shows the people you already work with.

### Running it
- `SEED_DEMO=1 docker compose up --build` gives a working instance with sample projects in about
  two minutes. Production compose file with nginx and gunicorn; a single-container image for
  platforms like Railway.
- Django 6.1, React 19, Vite 8, PostgreSQL 15+. Dependabot, secret scanning and CI are enabled.

[1.0.0]: https://github.com/vakahnke/Timeline/releases/tag/v1.0.0
