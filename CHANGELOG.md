# Changelog

Notable changes to Timeline. The format follows [Keep a Changelog](https://keepachangelog.com/),
and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **A template library.** A saved template can be shared with chosen teams or with everyone on
  the server, and the new Templates page lets people search, filter and sort what they can see.
  Each template has its own page with the plan drawn out, upvotes, comments and "make my own
  copy". Projects now remember the template they were started from, which gives every template a
  track record: started, finished, in flight, stalled, and how finished runs ran against the plan
  once three have finished. Totals only, and a project's owner can keep it out of the count.
- Sharing a template is a review step: you see every note and to-do title that would be shared,
  anything that looks like an email address, phone number or link is pointed out, and you can
  leave out notes or to-dos or share without your name.
- **Closing out a project.** When the last event in a project that came from a template reaches
  100%, its owner is offered three optional questions: how the plan worked (it worked, it worked
  with changes, it did not work, we stopped early), what it cost in money and/or person-days, and
  what to change next time. "Not now" is remembered, and **Close out…** is always in the gear menu.
  A template then shows "worked in 9 of 11 closed-out runs" and "typically costs about $14,000",
  under stricter rules than the time figure: a middle figure only, never a lowest or highest, three
  figures in one currency before anything appears, rounded, never converted, and a per-run switch
  to keep the numbers out. `DEFAULT_CURRENCY` sets the currency offered first.
- `TEMPLATE_LIBRARY` (`instance`, `teams` or `off`) lets an operator cap how far templates can be
  shared. Flagged templates and comments appear in the Django admin.

### Changed
- **A saved template is now the plan, not the record of one run.** Saving a finished project as a
  template keeps key-milestone flags and each event's to-do list, and no longer carries progress:
  a project started from it begins at zero percent with every to-do open and assigned to you.
  Templates saved earlier also start at zero.
- The README leads with what Timeline is for: plan it once, do it, keep the plan that worked.

### Fixed
- An event about 140px wide could not be Ctrl/⌘-dragged by its centre, because the hover buttons
  sat there.

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
