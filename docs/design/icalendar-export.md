# iCalendar Export — Design Document

**Status:** Draft
**Last updated:** 2026-09-19
**Scope:** A project's events as a standard `.ics` file (RFC 5545) that Outlook, Google Calendar and Apple Calendar can open. One new read-only endpoint, one menu item. No data-model change in phase 1.

---

## 0. Problem / motivating requirements

The people a project manager answers to live in their calendar, not in a planning tool. Today the
only ways to get Timeline dates in front of them are the status report and retyping.

- **R1.** Put a project's dates into any mainstream calendar without retyping them.
- **R2.** Works with Outlook (desktop and web), Google Calendar and Apple Calendar, which means
  strict RFC 5545: they each reject different mistakes.
- **R3.** Re-importing a newer export updates the same calendar entries; it must not create duplicates.
- **R4.** The author chooses what goes out. A sponsor wants five milestones, not ninety events.
- **R5.** Nobody outside the project can read it. Same access rule as the rest of the project.
- **R6 (later).** A calendar that stays current by itself, without exporting again.

Not in scope: importing `.ics` into Timeline, two-way sync, meeting invitations (METHOD:REQUEST),
recurring events (Timeline has none).

## 1. Current state (grounding)

- `Event` (`backend/events/models.py`) already has everything a calendar entry needs: `title`,
  `start`, `end` (timezone-aware; the server runs `TIME_ZONE = 'UTC'`, `USE_TZ = True`),
  `category`, `notes`, `percent_complete`, `is_milestone`, and `depends_on`.
- `Task` has a `due_date` (date only), `status` and `assignee`: the raw material for a personal
  "my deadlines" calendar later, not for phase 1.
- Project-scoped endpoints share `_ProjectScopedMixin` and `IsProjectMember`
  (`backend/events/views.py`, `backend/projects/permissions.py`): any member may read.
- **File downloads already work.** The PowerPoint export added a blob path to the API client
  (`req(..., { blob: true })` in `frontend/src/api.js` returns `{ blob, filename }` from
  `Content-Disposition`), and `CORS_EXPOSE_HEADERS` already exposes that header. The `.ics`
  download reuses it; nothing new is needed on the client beyond one call.
- The toolbar is crowded, and secondary actions live in the gear menu
  (`frontend/src/components/Toolbar.jsx`, the `settings-action` buttons).
- There is no token or share-link model anywhere yet. A subscribable feed would be the first.

## 2. Prior art / research

*Drafted from RFC 5545 and working knowledge of the three big calendar clients, not from fresh
tests. The client behaviours below are the first thing phase 1 must confirm with real imports.*

- **How the big calendars treat a `.ics` file.** Opening a file is a one-time import in all three.
  Google Calendar matches on `UID` when the same file is imported again into the same calendar
  and updates the entry; Outlook desktop does the same when `UID` and an increasing `SEQUENCE` or
  `DTSTAMP` are present; Apple Calendar asks which calendar to add to and also de-duplicates on
  `UID`. **A stable UID is therefore the whole of R3.**
- **The two classic correctness traps** are line folding (content lines longer than 75 octets must
  be folded with CRLF + space, counted in bytes, not characters) and text escaping (`\`, `;`, `,`
  and newlines). Outlook silently drops events from files that get either wrong.
- **Time zones.** UTC date-times (`20261106T140000Z`) are understood identically everywhere and
  need no `VTIMEZONE` block. Local times with `TZID` require embedding time zone rules and are the
  most common cause of "the meeting moved an hour" reports.
- **`PERCENT-COMPLETE` and `STATUS:COMPLETED`** are defined for `VTODO`, not `VEVENT`. Putting
  them on a `VEVENT` is invalid and ignored. Progress goes in the description.
- **`RELATED-TO`** is valid on `VEVENT` and is how dependencies are expressed, but no mainstream
  calendar displays it. It is harmless and keeps the file useful to other tools.
- **Subscriptions** (`webcal://` URLs) are how a calendar stays current. Google refreshes roughly
  every 12 to 24 hours and offers no control; Outlook and Apple are faster. Calendar apps cannot
  send a login, so the URL itself must carry the secret. Every tool that offers this (Asana,
  Jira, Basecamp, GitHub) uses a long random per-user token in the URL, revocable.
- **Libraries.** `icalendar` (BSD-2-Clause, pure Python, maintained by the Plone/collective
  community) handles folding, escaping and property typing. `ics.py` (Apache-2.0) is friendlier
  but has had long gaps between releases. Both licenses are compatible with Apache-2.0.

## 3. Proposed design

- **Data model.** Phase 1: none. Phase 2 adds one table for feed tokens (below).
- **API.** `GET /api/projects/<id>/calendar.ics`
  - Query: `only=milestones` (default `all`), `tracks=Design,Build` (optional filter by category).
  - Returns `text/calendar; charset=utf-8` with
    `Content-Disposition: attachment; filename="<project-slug>.ics"`.
  - One `VCALENDAR` (`PRODID:-//Timeline//EN`, `VERSION:2.0`, `CALSCALE:GREGORIAN`,
    `X-WR-CALNAME:<project name>`), one `VEVENT` per event:

    | iCalendar | From |
    |---|---|
    | `UID` | `event-<id>@<site host>` — stable for the life of the event (R3) |
    | `DTSTAMP`, `LAST-MODIFIED` | now, in UTC |
    | `DTSTART`, `DTEND` | `start`, `end` as UTC (`...Z`) |
    | `SUMMARY` | `title`, prefixed `◆ ` for a key milestone |
    | `DESCRIPTION` | notes, then `Track: …`, `Progress: NN%`, and `N of M tasks done` |
    | `CATEGORIES` | `category` |
    | `STATUS` | `CONFIRMED` |
    | `TRANSP` | `TRANSPARENT` — a project phase must not show the person as busy for six weeks |
    | `RELATED-TO;RELTYPE=PARENT` | one per `depends_on`, pointing at that event's UID |
    | `URL` | link back to the project in Timeline |

  - **Milestones are exported as timed events** at their real end time, one hour long ending at
    `end`. (An all-day entry is an alternative; see open questions.)
- **Builder.** `backend/events/ical_export.py`, a pure function `build_ics(project, events, host)`
  returning bytes, built with the `icalendar` library. Kept free of request objects so it is
  trivially unit-tested, the same shape as `pptx_export.py`.
- **UI / UX.** One item in the gear menu: **Export calendar (.ics)**, opening a small dialog with
  two choices (everything / key milestones only) and a Download button. Also offered from the
  status report's side panel, because that is where a PM already is when thinking about what
  leadership should see.
- **Permissions impact.** None new. Any project member may export, exactly as any member may read
  the events. Non-members get 403/404 and anonymous requests 401, as elsewhere.

**Phase 2 design: subscribable feed.** New model `CalendarFeed(user, project, token, only,
created_at, last_used_at, revoked_at)`; the token is 32 random bytes, URL-safe, stored hashed.
`GET /api/feeds/<token>/calendar.ics` needs no login, returns the same file for that user's
current access to that project (checked live on every request, so removing someone from the
project kills their feed), is rate-limited, and sends `Cache-Control: private, max-age=900`.
The UI shows the `webcal://` link once with Copy, lists active feeds, and revokes them.

## 4. Alternatives considered

- **Hand-roll the format** (about 60 lines). Avoids a dependency, but folding-by-octets and
  escaping are exactly where hand-rolled exporters break, and the break is silent. Rejected.
- **Local times with `TZID`.** More "natural" in the file, but needs `VTIMEZONE` rules and is the
  main source of cross-client bugs. UTC displays in the viewer's own zone anyway. Rejected.
- **`VTODO` for events** so percent complete is first-class. Outlook and Google ignore `VTODO` on
  import, so the dates would not appear at all. Rejected; `VTODO` is right for task deadlines later.
- **Generate the file in the browser.** No server work, but the feed in phase 2 needs a server
  builder regardless, and two implementations would drift. Rejected.
- **Google/Microsoft calendar API integration.** Real sync, but OAuth apps, verification reviews
  and per-vendor code for a self-hosted tool. Out of proportion. Rejected for now.

## 5. Phasing

- **Phase 1 (MVP): the file.** Endpoint, builder, gear-menu item with the everything/milestones
  choice, tests for structure, CRLF, 75-octet folding, escaping, UTC, stable UIDs, `RELATED-TO`,
  and permissions. Verified by importing the real file into Google, Outlook and Apple Calendar.
- **Phase 2: the feed.** Tokenized `webcal://` subscription per user and project, revocable.
- **Later / maybe:** a personal "my deadlines" calendar across projects from task `due_date`s
  (as `VTODO` plus all-day `VEVENT`); per-track calendars; `.ics` import.

## 6. Cost & risk

- **Effort:** Phase 1 **S**. Phase 2 **M** (first token model, rate limiting, a small settings UI).
- **Migration / data risk:** Phase 1 none (read-only, no schema change). Phase 2 one additive table.
- **Perf / UX risk:** none on the timeline. The export is one query plus the dependency prefetch.
- **Security:** phase 1 exposes nothing a member cannot already read. Phase 2 creates an
  unauthenticated URL: the token must be unguessable, hashed at rest, revocable, scoped to one
  project, and re-checked against live membership on every request. Feed URLs end up in calendar
  providers' servers; the UI must say so.
- **Blast radius:** a new endpoint and a menu item. Nothing existing changes.
- **Dependency:** `icalendar` (BSD-2-Clause) and its dependency `python-dateutil` (Apache-2.0 /
  BSD-3-Clause dual) and `tzdata`. All compatible; they go in `THIRD_PARTY_LICENSES.md`.

## 7. Open questions / decisions needed

- [ ] **Milestones: timed or all-day?** Timed (proposed) is exact; all-day reads better in a
      month view and avoids "launch at 9:00 UTC" looking like a meeting.
- [ ] **Default scope:** everything (proposed) or key milestones only?
- [ ] **Busy or free?** Proposed `TRANSPARENT` (free). Anyone who wants phases to block time?
- [ ] **Is the feed (phase 2) wanted at all?** It is the part with real security surface.
- [ ] **Does prod need it, or only the open-source users?** Decides whether phase 2 is worth it.
