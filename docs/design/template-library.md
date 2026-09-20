# Template Library: explore, vote, comment, share — Design Document

**Status:** Draft
**Last updated:** 2026-09-19
**Scope:** Turns saved templates from a private list into a library people can browse, judge and pass around: inside one instance first, then between instances as a file or link, then as a community gallery. Touches the template model and API, a new Library page, project creation, and (phase 3) the GitHub repository.

---

## 0. Problem / motivating requirements

The README's promise is "keep the plan that worked". Today that plan can only be kept by the one
person who saved it. A team cannot see each other's templates, cannot tell a good one from an
abandoned one, and cannot hand one to someone at another company.

- **R1. Explore.** Browse every template you are allowed to see, with search, tags and sorting,
  and **see the plan before using it**: its tracks, durations, dependencies and milestones.
- **R2. Judge.** Signal which templates are good. Votes are one signal; the better one is a
  **track record**: how many projects were started from it, how many finished, and how they ran
  against the plan. That is what "proven" means.
- **R3. Discuss.** Comment on a template: what worked, what to change, what it assumes.
- **R4. Share inside an instance.** Publish a template to your team or to everyone on the instance.
- **R5. Share outside it.** Hand a template to anyone as a file or a link, with no account on your
  instance, and import one you were given.
- **R6. Improve over time.** Save a better version of a template without losing its votes,
  comments and history. "Save it again if you learned something."
- **R7. Nothing private leaks.** A template made from a real project can carry notes, to-do
  titles and names. Publishing must show exactly what will be shared and let the author strip it.
- **R8. Self-hosted first.** Everything in phases 1 and 2 works on an instance with no internet.

Not in scope: a hosted marketplace with accounts, paid templates, ratings of people, or
real-time co-editing of a template.

## 1. Current state (grounding)

- **`ProjectTemplate`** (`backend/projects/models.py`): `name`, `description`, `owner`,
  `categories` (JSON), `tasks` (JSON), `created_at`. **Strictly private**: every query filters
  `owner=request.user` (`_saved_items`, `_resolve_template`, `destroy` in `backend/projects/views.py`).
  No visibility, tags, slug, version or link to a parent. (Its docstring still lists
  `percent_complete` in the task shape, which templates no longer carry; fix when this is built.)
- **Built-ins** live in code (`templates_builtin.py`, 21 of them) and are addressed by key
  (`builtin:<slug>`); saved ones by `saved:<id>`. `HiddenBuiltinTemplate` lets staff retire a built-in.
- **The template spec** (`spec_from_project` in `backend/projects/templates.py`), as of
  2026-09-19: tracks; events with relative start, duration, notes, key-milestone flag and
  dependencies by index; each event's to-dos with due dates as day offsets. It deliberately drops
  dates, progress, assignees and members. **It is already a portable, self-contained JSON
  document**, which makes R5 cheap.
- **API** (`TemplateViewSet`): `GET /api/templates/` (built-ins + your own), `POST` (save from a
  project you belong to), `DELETE`, `POST …/instantiate/`. The list returns only name,
  description and counts; **there is no endpoint that returns a template's content**, so nothing
  can preview one today.
- **Nothing records provenance.** A project created from a template keeps no reference to it, so
  "how many times was this used, and did it work?" cannot be answered (R2).
- **UI:** `TemplateModal.jsx`, a picker opened from the dashboard's "From Template". No page.
- **Building blocks that exist:** the comment pattern (`Comment`, author-or-owner moderation);
  throttling (`password_reset.py`); file downloads in `api.js`; `ReportTimeline.jsx`, which
  already draws a compact timeline from plain data and can draw a template preview; the rule that
  the people directory only reveals people you already work with (`directory.py`), which a public
  author name on a library entry would cut across.

## 2. Prior art / research

*From working knowledge of these products, not fresh testing. Confirm the specifics worth copying
before building.*

- **Notion, Trello, Asana, Airtable Universe, Miro:** a gallery with categories, a preview you
  can look around in before copying, a "use this template" button, a creator name and a usage
  count. Usage count is the number people actually trust; star ratings are mostly noise.
- **Grafana dashboards, Home Assistant blueprints:** the pattern for *self-hosted* software. The
  artifact is a JSON/YAML file; you share it by URL or ID and the app has an "import from URL"
  box. Reviews and download counts live on the community site, not in each install.
- **Obsidian community plugins:** the cheapest possible community registry. One JSON index in a
  GitHub repository; additions arrive as pull requests and are reviewed; every install reads the
  index over HTTPS. No server, no accounts, moderation by code review, and the project's
  repository gains contributors. This is the model for phase 3.
- **Upvotes only.** Communities that allow downvotes on people's work get less of it. One
  upvote per person, plus usage, is enough to sort by.
- **What nobody offers** and this app uniquely can: a track record computed from real runs of the
  plan. A template that says "started 14 times, finished 11, typically runs 6% long" is a
  different kind of object from one with 40 likes.

## 3. Proposed design

### 3.1 Three rings of sharing

| Ring | Who sees it | How it travels | Needs internet |
|---|---|---|---|
| **Private** (today) | you | — | no |
| **Instance library** (phase 1) | chosen teams, or everyone signed in to this instance | published in place | no |
| **File or link** (phase 2) | anyone you send it to | a `.plan.json` file, or an import-from-URL box | only to fetch a URL |
| **Community gallery** (phase 3) | anyone running the app | a reviewed index in the GitHub repository | yes, optional, can be switched off |

### 3.2 Data model

- **`ProjectTemplate`** gains: `visibility` (`private` | `teams` | `instance`), `shared_with_teams`
  (M2M to `Team`), `slug`, `summary` (one line), `tags` (JSON list), `group` (business / work /
  hobby / other), `author_display` (`name` | `anonymous`), `published_at`, `version` (int),
  `version_note` ("what I learned"), `forked_from` (FK to self, nullable), `origin` (JSON: where an
  imported template came from), `updated_at`.
- **`TemplateVersion`**: `template`, `version`, `categories`, `tasks`, `note`, `created_at`. Saving
  a better plan adds a version; votes, comments and the track record stay with the template (R6).
- **`TemplateVote`**: `user`, `template_key` — unique together. **Keyed by the template key, not a
  foreign key, so built-ins can be voted and commented on like any other.**
- **`TemplateComment`**: `template_key`, `author`, `body`, timestamps. Flat, newest last.
- **`Project.source_template_key`** and **`source_template_version`**, set at instantiation. This is
  the provenance R2 needs. Nullable; existing projects simply have none.
- Migrations are additive.

### 3.3 The track record (R2)

Computed per template from the projects that were started from it:

- **Started**, **finished** (all events at 100%), **in flight**, **abandoned** (no change in 60 days).
- **How it ran:** median of (actual length ÷ planned length) across finished runs, shown as
  "typically runs 6% long". Only shown with **three or more** finished runs, so one project's
  schedule can never be read off it.
- Aggregates only. It never lists which projects or whose. A project owner can opt a project out
  ("don't count this run") for confidential work.

### 3.4 API

- `GET /api/templates/library/?q=&tag=&group=&sort=` — everything the caller may see. Sort by
  `proven` (finished runs, then votes; the default), `popular`, `new`, `name`.
- `GET /api/templates/<key>/` — the full content, for preview. **New:** today nothing returns it.
- `PATCH /api/templates/<key>/` — owner: summary, tags, group, visibility, teams, author display.
- `POST …/<key>/publish/` and `…/unpublish/`; `POST …/<key>/versions/` (save a new version from a project).
- `POST|DELETE …/<key>/vote/`; `GET|POST …/<key>/comments/`, `PATCH|DELETE …/comments/<id>/`.
- `POST …/<key>/fork/` — a private copy to adapt, linked back by `forked_from`.
- Phase 2: `GET …/<key>/export/` (the `.plan.json` file), `POST /api/templates/import/`
  (`file` or `url`, with `dry_run`), and optionally `GET /t/<slug>` public preview.
- `instantiate` is unchanged apart from recording provenance and accepting library keys.

### 3.5 UI / UX

- **A Library page** (`/templates`), linked from the dashboard beside "From Template". Cards show
  name, one-line summary, group and tags, author (or "a member"), length, number of tracks and
  events, **the track record**, votes and comment count. Search, tag chips, the sort menu.
  "Official" marks the built-ins.
- **A template page** (`/templates/<slug>`): a read-only, zoomable drawing of the plan (reusing
  `ReportTimeline`): tracks, bars, dependency lines, milestone diamonds. Beside it: the
  description, what it assumes, version history with each "what I learned" note, the track
  record, **Use this template**, **Make my own copy**, **Share**, the vote button and the comments.
- **Publishing is a review step, not a toggle (R7).** The dialog shows *exactly* what will be
  shared, every note and to-do title in one scrollable list, with three switches: include notes,
  include to-dos, show my name. It warns when the text contains an email address or an `@name`.
  Nothing is published until the author has seen that list.
- **Share** offers: copy link (works for anyone who may see it), download the file, and, once it is
  public on an instance that allows it, the public link.
- **From a project:** "Save as Template" gains "…or save as a new version of *Launch playbook*"
  when the project was started from one of your templates.
- Works on a phone: the library is a single column of cards, the plan preview fits the width.

### 3.6 Permissions impact

Decided on the server, as everywhere else ([PERMISSIONS.md](../PERMISSIONS.md)).

| Action | Who |
|---|---|
| See a template | its owner; members of a team it is shared with; any signed-in user if `instance` |
| Use, fork, vote, comment | anyone who can see it |
| Edit, publish, unpublish, add a version, delete | the owner (staff may unpublish) |
| Delete a comment | its author, the template's owner, or staff |

- **Author names versus the people directory.** Publishing to the whole instance shows your name
  to people you do not share a project with, which the directory rule otherwise prevents. That is
  why `author_display` exists and why the publish dialog says so plainly. Default: `name` when
  sharing with teams, and an explicit choice when sharing with the instance.
- Votes, comments and imports are throttled. Instance setting `TEMPLATE_LIBRARY` =
  `off` | `teams` | `instance` lets an operator cap how far sharing can go.

### 3.7 The file format (phase 2)

`<slug>.plan.json`: `{ "format": "plan-template", "version": 1, "name", "summary",
"description", "group", "tags", "author", "license", "categories", "tasks", "origin" }`, with
`categories` and `tasks` exactly as `spec_from_project` produces them.

Import treats the file as hostile, like any upload: a 1 MB cap, a strict schema (known keys, types
and lengths; at most 500 events and 2,000 to-dos), dependency indexes in range and **no loops**,
plain text only. Import-from-URL fetches over HTTPS only, refuses private and link-local
addresses, follows no redirects off the host, and times out fast. A `dry_run` shows what will be
created. Imported templates start **private**.

### 3.8 The community gallery (phase 3)

- A `community-templates/` folder in the GitHub repository: one `.plan.json` per template and an
  `index.json` built by a GitHub Action. **Submitting a template is a pull request**; review is the
  moderation. In-app, "Submit to the community" downloads the file and opens a prefilled GitHub
  page. No server to run, and the repository gains contributors and a reason to be starred.
- The app reads `index.json` over HTTPS (cached for a day), shows those templates under a
  **Community** tab, and imports one with a click. Operators can switch it off
  (`COMMUNITY_TEMPLATES=0`); air-gapped instances lose nothing else.
- Community votes and discussion live on GitHub (a Discussions thread per template; 👍 reactions
  are counted into `index.json` by the same Action), so instances never need a GitHub token. The
  track record stays local: an instance only knows its own runs.
- Licence: contributions are accepted under CC BY 4.0 (or CC0), stated in the folder's README.

## 4. Alternatives considered

- **A hosted hub service** with accounts, votes and comments shared by all instances. The real
  "marketplace", and a second product to build, host, secure and moderate. Rejected for now; the
  GitHub-backed gallery gets most of the value for almost none of the cost.
- **Star ratings (1–5) or downvotes.** More data, worse behaviour, and less useful than usage.
- **Make every saved template visible to the whole instance by default.** Simplest, and a privacy
  accident waiting to happen: templates come from real projects. Sharing must be a deliberate act.
- **Share by giving access to a template** (like project membership) instead of publishing.
  Familiar, but it produces a permissions matrix for templates and no library to browse.
- **Skip the track record** and ship votes only. Cheaper, but it gives up the one thing no other
  tool has, and the one most in keeping with "the plan that worked".
- **Votes and comments as foreign keys to `ProjectTemplate`.** Cleaner, but built-ins live in code
  and would need rows of their own. Keying by `template_key` treats both alike.

## 5. Phasing

- **Phase 1 — the instance library.** Visibility (private / teams / instance), the publish review
  step, the Library page with preview, search, tags and sorting, votes, comments, forking, and
  provenance on new projects. *The track record appears as soon as projects start from templates.*
- **Phase 2 — files and links.** Export, import (file and URL) with the hostile-file checks,
  versions with "what I learned" notes, optional public preview pages.
- **Phase 3 — the community gallery.** The folder and Action in the repository, the Community tab,
  one-click import, the submit flow.
- **Later / maybe:** following a template to hear about new versions; diffing two versions;
  suggesting a template from a project's name; a gallery website generated from `index.json`.

## 6. Cost & risk

- **Effort:** Phase 1 **L** (model, permissions, a new page, the preview, the publish review).
  Phase 2 **M**. Phase 3 **M**, mostly outside the app (the Action, contribution docs, review time).
- **Migration / data risk:** additive and reversible. Existing templates stay private. Existing
  projects have no provenance, so track records start from zero.
- **Privacy risk: the main one.** People will publish templates cut from real projects. Mitigated
  by the review step, private-by-default, the anonymous option, aggregate-only statistics with a
  minimum of three runs, and a per-project opt-out.
- **Moderation.** Comments and published text on an open-registration instance (the public demo)
  need a report button and staff removal from day one. The demo also resets every six hours.
- **Security.** Phase 2 adds an upload and a server-side URL fetch (the classic route to
  server-side request forgery); both are specified defensively in 3.7 and need adversarial tests
  like `tests_authority.py`.
- **Perf / UX risk:** none on the timeline. The library list must not load template bodies;
  previews load on demand. Track records are cached and recomputed when a project changes.
- **Blast radius:** template queries change from `owner=user` to a visibility rule. That rule is
  the security boundary and gets its own test file before anything else is built.
- **Ongoing cost:** phase 3 creates review work for the maintainer for as long as it exists.

## 7. Open questions / decisions needed

- [ ] **How far should sharing go first?** Proposed: teams and whole-instance in phase 1.
- [ ] **Is the track record wanted**, and are three finished runs the right minimum to show it?
- [ ] **Upvotes only** (proposed), or something richer?
- [ ] **Names on published templates:** the author's choice each time (proposed), or always named?
- [ ] **Public preview pages** with no sign-in: useful for sharing and for the demo; off by default?
- [ ] **Where should the community gallery live:** a folder in this repository (proposed, brings
      contributors here) or a separate repository (keeps this one's history clean)?
- [ ] **Licence for community templates:** CC BY 4.0 (credit required) or CC0 (no strings)?
- [ ] **Should the built-ins be votable and commentable** like everything else? Proposed yes.
