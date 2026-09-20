# Template library, phase 2: files, links, versions, authors — Design Document

**Status:** Draft
**Last updated:** 2026-09-20
**Scope:** Lets a template leave the server it was saved on (as a file, or by a link), lets it improve over time without losing its history, and gives authors a page. Builds on [template-library.md](template-library.md) (phase 1, shipped) and [template-closeout.md](template-closeout.md) (phases A and B, shipped). Touches the template model and API, the template page, project creation, and adds the first signed-out data page.

---

## 0. Problem / motivating requirements

Phase 1 made a library inside one server. Three things are still missing.

- **R1. Hand a plan to someone on another server.** An expert who ran a launch well should be able
  to give the plan to anyone, with no account on the expert's server. A file is the floor; a link
  is the convenience.
- **R2. Take a plan in safely.** A template file comes from a stranger. Importing one must not be
  able to harm the server, and the person importing must see what they are getting first.
- **R3. A plan gets better without starting over.** "Save it again if you learned something" is in
  the README, but saving again today makes a *separate* template with no votes, no comments and no
  track record. A better version must keep all three.
- **R4. Lessons turn into the next version.** Close-out lessons already reach the template's owner.
  They should be in front of the owner at the moment they write "what I learned".
- **R5. Know which version a run used,** so a template can say whether version 3 runs better than
  version 2 (close-out phase C).
- **R6. Authors are people.** Someone who shares good plans should have a page: who they are, a
  link, their plans. It must not undo the rule that the people directory only shows people you
  already work with.
- **R7. Nothing here needs the internet, and nothing here makes the server fetch an address a user
  typed.** (See 3.3: this removes the riskiest piece of the original sketch.)

Not in scope: the community gallery (phase 3), paid or licensed-for-a-fee templates, editing a
template's events in place, merging two versions, comments on versions.

## 1. Current state (grounding)

- **A template is already a portable document.** `ProjectTemplate.categories` and `.tasks` are
  plain JSON in the shape `spec_from_project` writes (`backend/projects/templates.py`): relative
  offsets, durations, notes, key-milestone flags, dependencies by index, to-dos with day offsets.
  Nothing in it refers to a database row.
- **What other people get is filtered at read time** (`library.Resolved.spec`): the owner's
  `share_notes` / `share_todos` switches apply to every path. An export must go through the same door.
- **`GET /api/templates/<key>/`** already returns the full plan to anyone allowed to see it. There
  is no export, no import, and no way to create a template except "save from a project" and "fork".
- **The API accepts JSON only** (`DEFAULT_PARSER_CLASSES` is `JSONParser`), and the frontend already
  saves server-made files (`saveBlob` in `ExportModal.jsx`). So a file import needs no upload
  handling: the browser reads the file and posts its JSON.
- **The server has no HTTP client** (`requests` is not installed) and has never fetched a URL.
- **Every data endpoint requires sign-in.** The only public endpoints are register, sign-in, password
  reset and health. There is no Content-Security-Policy, so the browser may fetch from other origins.
- **No versions.** `ProjectTemplate` has `updated_at` and nothing else; `Project.source_template_key`
  and `source_template_span` exist, `source_template_version` does not. Track records
  (`library.track_records`) group by key only.
- **No author identity beyond `username`.** The user model has no display name, bio or link. The
  people directory (`directory.py`) deliberately shows only people you share a project or team with;
  a published template shows its author's username only if they chose `author_display = name`.
- **`origin_project`** (close-out phase B) and **`forked_from_key`** already record where a template
  came from *inside* a server. Nothing records where an *imported* one came from.

## 2. Prior art / research

*From working knowledge, not fresh testing.*

- **Grafana dashboards, Home Assistant blueprints, n8n workflows:** the artifact is a JSON or YAML
  file; you share the file or a URL to it; the app has "import" and shows what it found before
  saving. Home Assistant's "import blueprint" button on a web page is the model for a link that
  opens *your own* server's import screen.
- **Browser-side fetch versus server-side fetch.** Tools that fetch a user-supplied URL from the
  server have a long history of server-side request forgery (reaching cloud metadata addresses and
  internal services). Tools that let the *browser* fetch it have none of that class of bug: the
  browser can only reach what the user could already reach, and cross-origin rules apply. GitHub
  raw files and gists are served with open cross-origin headers, which covers the realistic cases.
- **Versioning in template galleries** (Figma community files, Notion templates, VS Code extensions):
  one listing, many versions, a changelog line per version, reviews and installs stay with the
  listing. Nobody makes you start from zero to publish an improvement.
- **Author pages** (Figma, Printables, Observable): name, short bio, one link, their work. The useful
  number is about the work ("12 plans, run 140 times"), not about the person.
- **Licences:** galleries that skip the question end up with ambiguity; the ones that ask offer two
  or three well-known choices, not a text box.

## 3. Proposed design

### 3.1 The file

`<name>.plan.json`, UTF-8, one template:

```
{ "format": "plan-template", "version": 1,
  "name", "summary", "description", "group", "tags": [...],
  "author": "name or null", "license": "CC-BY-4.0" | "CC0-1.0" | null,
  "template_version": 3, "version_note": "what I learned",
  "categories": [...], "tasks": [...],            // exactly the stored shape
  "source": { "exported_at": "...", "track_record": { ...totals as shown on the page... } } }
```

- **Export goes through the same filter as viewing.** A non-owner gets the plan as they see it. The
  **owner** exporting their own template gets the same review step as publishing (the list of every
  note and to-do title, the warnings, the three switches), because a file travels further than any
  share setting.
- The file carries **totals only** in `source.track_record`, under the display rules already in
  force (minimums, median, rounding). An importing server shows them as **"At its source: …"**,
  clearly separate from its own record, because it cannot verify them. No lessons, no comments, no
  votes, no usernames except the author's chosen display name.

### 3.2 Import

- **Templates → Import** takes a file (read in the browser, posted as JSON to
  `POST /api/templates/import/`) and shows a **preview before saving** (`dry_run`): name, author,
  licence, the plan drawing, counts, and anything that looks like a link or an address in its text.
- **The server treats the document as hostile:** at most 1 MB; `format` and `version` must match;
  known keys only, each with a type and a length limit; at most 500 events, 40 tracks, 2,000
  to-dos; offsets and durations within sane bounds (no plan longer than 20 years); dependency
  indexes in range, **no loops** (the same check the event API uses); colours must be hex; all text
  is stored as text and rendered as text (React already escapes; no HTML, no Markdown).
- An imported template is **private**, owned by the importer, with an `imported_from` record (author
  as stated, licence, source totals, file or link, when). Its page says "Imported · by *author* ·
  *licence*". Its own track record starts at zero.
- Importing is throttled per user.

### 3.3 Links, without the server fetching anything

Two kinds of link, and **the server never requests a user-supplied address** (R7):

1. **Import from a link.** The import screen has a URL box. The **browser** fetches it and posts
   the JSON through the same import endpoint and the same checks. Works for anything served with
   open cross-origin headers (GitHub raw files and gists, and public template links from 3.4). If
   the browser cannot fetch it, the message says so and suggests downloading the file instead.
2. **"Open in my server" links.** `https://<your-server>/templates/import?url=<address>` opens the
   import screen with the box filled in, so a web page can offer an "Import this plan" button
   (the Home Assistant pattern). Nothing is fetched until the person clicks, and nothing is saved
   until they have seen the preview.

This replaces the server-side fetch in the original sketch. It removes the whole class of
server-side request forgery, needs no HTTP client on the server, and works on an air-gapped
server as far as that server's users can reach anything at all.

### 3.4 Public template links (optional, off by default)

- A template's owner can turn on **"Anyone with the link can view"**, which mints an unguessable
  link: `/t/<random-token>`. It shows a signed-out page with the name, summary, description, the plan
  drawing, the track record totals and the author's chosen display name. **No comments, no
  usernames, no votes list.** "Use this template" leads to sign-in.
- The same token serves the file at `/t/<token>.plan.json` with open cross-origin headers, which is
  what makes 3.3 work between two servers.
- Turning it off, unpublishing, or deleting kills the link. The publish review applies first.
- **Server setting `TEMPLATE_PUBLIC_LINKS`** (`off` by default). This is the app's **first signed-out
  data page**, so it is opt-in per server as well as per template, throttled per address, read-only,
  and served by one narrow view that can return nothing but that document.

### 3.5 Versions

- **`TemplateVersion`**: `template`, `number`, `categories`, `tasks`, `note`, `created_at`. The
  template row keeps holding the current plan, so nothing that reads a template changes.
- **Saving a new version:** "Save as Template" gains a choice when you own templates: *a new
  template*, or *a new version of …* (preselected when the project was started from one of yours).
  It asks for **"What I learned"**, and shows the **lessons received since the last version**
  beside the box (close-out phase B), so they can be folded in (R4).
- Votes, comments, the track record, sharing settings and links all **stay with the template** (R3).
- The template page gets a **Versions** list: number, date, note, and how many runs used it. Older
  versions can be previewed; using or exporting always takes the latest. Restoring an old version
  is "save it as the newest" and is left for later.
- **`Project.source_template_version`** is set at instantiation (R5). Existing projects count as
  version 1.
- **Close-out phase C:** the track record keeps its overall totals and adds the same totals for the
  **current version** once it has enough runs of its own, under the same minimums, so the page can
  say "version 3: typically runs 2% long (overall 7%)".
- A fork records `forked_from_version`.

### 3.6 Author pages

- **`AuthorProfile`** (one per user, optional): `display_name`, `bio` (500 characters), `link` (https
  only, shown with `rel="nofollow noopener"`).
- **`/people/<username>`** exists **only for someone who has shared a template under their name**, and
  shows only the named templates **the viewer is allowed to see**, plus their combined totals
  ("6 plans · started 140 times · 96 finished"). If the viewer can see none, the page is a 404, the
  same as for a user who does not exist. Templates shared without a name are never listed.
- This keeps the directory rule intact: an author page reveals nothing that the templates the viewer
  can already see did not reveal, and it cannot be used to look people up.
- On a public template link (3.4) the author is a display name, not a link to a page.

### 3.7 Licence

A `license` field on a template: **not stated** (default), **CC BY 4.0** (reuse with credit), or
**CC0** (no conditions). Shown on the template page, asked when sharing to the whole server or
exporting, carried in the file, and kept on import. No free-text licences.

### 3.8 Permissions impact

| Action | Who |
|---|---|
| Export a template | anyone who can see it (they get what they can see); owners get the review step |
| Import | any signed-in user; the result is private to them |
| Save a new version, write its note, turn a public link on or off, set the licence | the template's owner |
| See versions and their notes | anyone who can see the template |
| View a public link | anyone with the token, if the server allows public links |
| Edit an author profile | that user |
| See an author page | signed-in users who can see at least one of that author's named templates |

All decided on the server from the token and the database, as in
[PERMISSIONS.md](../PERMISSIONS.md). The file's `author` field is a claim, displayed as a claim; it
grants nothing.

## 4. Alternatives considered

- **Server-side "import from URL"** (the original sketch). It works for any address regardless of
  cross-origin headers, and it is the classic route to server-side request forgery; defending it
  properly (address filtering after DNS resolution, redirect handling, timeouts, size caps) is a
  permanent maintenance burden for a convenience. Rejected in favour of the browser fetching.
- **Multipart file upload.** Unnecessary: the browser reads a small JSON file and posts JSON, which
  the API already accepts. No new parser, no temp files.
- **A new template per version, linked in a chain.** Simple to build, and it is exactly the problem
  being solved: votes, comments and history scatter across the chain.
- **Readable public links** (`/t/launch-playbook`). Nicer to look at, guessable, and they invite
  name squatting. A random token is a capability: having it is the permission.
- **Public author pages.** Better for the authors, and the first step to the app becoming a people
  directory. Kept signed-in and scoped to what the viewer can already see.
- **Carry votes and comments in the file.** They are about a community on one server; exported they
  are unverifiable noise with usernames attached.
- **Sign the files.** Would let an importing server trust `author` and the source totals. Real value
  only once there is a gallery to trust; revisit with phase 3.

## 5. Phasing

Each step ships by itself.

- **2a — the file.** Export (with the owner's review step), import from a file with preview and the
  hostile-document checks, `imported_from`, the licence field. *Satisfies R1 (the floor) and R2.
  This is the step that lets a plan be handed to anyone.*
- **2b — versions.** `TemplateVersion`, "save as a new version" with lessons alongside, the Versions
  list, `source_template_version`, per-version totals. *Satisfies R3, R4, R5 and close-out phase C.*
- **2c — author pages.** `AuthorProfile`, the page, links from template cards. *Satisfies R6.*
- **2d — links.** Import from a link via the browser, "open in my server" links, and public
  template links behind `TEMPLATE_PUBLIC_LINKS`. *Completes R1. Last because it adds the first
  signed-out data page.*
- **Later / maybe:** restoring and comparing versions; signed files; following a template for new
  versions; "import" buttons on the project's website for the built-in plans.

## 6. Cost & risk

- **Effort:** 2a **M**, 2b **M**, 2c **S to M**, 2d **M**. Together about the size of library phase 1.
- **Migration / data risk:** additive. Existing templates become version 1; existing projects are
  treated as having used version 1.
- **Security.** Import is the app's first path where a stranger's document becomes stored data: it
  gets a strict schema and its own adversarial test file (oversized, deeply nested, wrong types,
  dependency loops, absurd offsets, markup in text) before any UI. Dropping the server-side fetch
  removes the largest risk in the original sketch. 2d adds a signed-out page: one narrow view,
  throttled, off by default, tokens unguessable and revocable.
- **Privacy.** A file outlives every share setting, hence the review step on the owner's export. The
  file carries totals only, never lessons, comments or usernames. Author pages are scoped to what the
  viewer can already see.
- **Trust in imported numbers.** "At its source" totals are claims. They are labelled as such and
  never mixed into the local record.
- **Perf / UX:** versions add one row per save; per-version totals reuse the grouped track-record
  query with one more grouping key. No timeline impact.
- **Blast radius:** the instantiate path gains a version number; "Save as Template" gains a choice;
  the rest is new surface.

## 7. Open questions / decisions needed

- [ ] **Order:** 2a, 2b, 2c, 2d as proposed? (2b first would suit "improve my own plans" more than
      "hand a plan to someone".)
- [ ] **Browser-side link import instead of a server-side fetch** (proposed). It will not work for a
      host that blocks cross-origin requests; the fallback is downloading the file.
- [ ] **Public template links:** build them at all in this phase? If so, on for the demo and **off on
      the production server** unless you say otherwise.
- [ ] **Licence choices:** not stated / CC BY 4.0 / CC0 (proposed), and should sharing to the whole
      server *require* a choice, or merely offer it?
- [ ] **Source totals in the file:** include them, labelled "at its source" (proposed), or leave the
      file as the plan alone?
- [ ] **Author pages:** signed-in and scoped as proposed, or not needed yet?
- [ ] **File extension and format name:** `.plan.json` / `plan-template` (neutral on purpose, so it
      survives any future change to the product's name).
