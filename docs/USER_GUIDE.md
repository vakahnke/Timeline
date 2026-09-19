# User Guide

How to use Timeline day to day. (To run it, see the [README](../README.md) and
[Deployment](DEPLOYMENT.md).)

## 1. Accounts

- **Register** at `/register` with a username, email, and password — you're signed in
  immediately and land on your projects dashboard.
- **Log in** at `/login`. Your session is remembered across reloads; **Log out** from the
  dashboard header.

With the demo data loaded, you can sign in as `demo`, `editor`, or `viewer` (password
`demo12345`) to feel the different roles.

## 2. Projects

The dashboard lists every project you're a member of. Each card shows its **role badge**,
**date range** (first task → last task), a **progress bar** (average task completion), and
counts. Hover a card to **edit** (editors+) or **delete** (owners) it.

- **+ New Project** — a blank project (you become its owner).
- **From Template** — a ready-made plan: pick a template, set a **name** and **start date**,
  and optionally **assign it to another user** (they become the owner; you're added as a
  co-owner). See [Templates](#4-templates).
- Click a project card to open its **timeline**.

### Roles

| Role | Can do |
|------|--------|
| **Owner** | Everything an editor can, **plus** manage members/teams and delete the project |
| **Editor** | Create / edit / delete events and categories; edit project details |
| **Viewer** | Read-only — view the timeline, but no editing affordances are shown |

## 3. The timeline

The heart of the app. Events are bars arranged into **tracks** (one per category).

### Working with events (editors & owners)

- **Create:** double-click an empty spot in a track, or **+ New Event** in the toolbar.
- **Open / edit:** **click an event** (works even on tiny bars) to open the editor — title,
  start/end, category, **% complete**, notes, and **dependencies**. Wider bars also show
  inline ✎ edit / ✕ delete buttons on hover.
- **Move:** events are *sticky* so you don't nudge them by accident — **hold Ctrl/⌘ and
  drag** to reschedule (drag onto another track to recategorize). A plain drag pans the
  timeline instead. The cursor turns into a move arrow over events while Ctrl/⌘ is held.
- **Resize:** **Ctrl/⌘-drag** either edge.
- **On a phone or tablet:** drag to pan and **pinch to zoom**. **Press and hold** an event to pick it
  up, then drag it to a new time or track. A press and hold also selects the event and shows two
  **dots** at its ends; drag a dot to resize. A quick swipe that starts on an event still pans, so
  nothing moves by accident, and **Undo** is in the toolbar. Tap elsewhere to deselect. The track names collapse
  to a thin colour rail on the left to give the timeline the screen; tap the rail to slide them out.
- **Delete:** from the inline ✕ or the editor's **Delete** button.

### Categories (tracks)

- **+ New Category** in the toolbar.
- Click a track's name to **rename / recolor** it (this updates its events).
- Drag the ⠿ handle to **reorder** tracks.

### Dependencies & critical path

- In an event's editor, tick **Depends on** predecessors. Arrows are drawn between linked
  events.
- The **critical path** (the chain that determines the project's finish) is highlighted in
  red automatically.
- The gear menu toggles **dependency arrows** and **critical-path-only** view, and sets the
  drag **snap** interval.

### Getting around

| Action | How |
|--------|-----|
| **Zoom** | `Ctrl`/`⌘` + scroll, or pinch on a trackpad, or the toolbar `+` / `−`, or the `+` / `−` keys |
| **Fit everything** | **Fit** button, or press `0` |
| **Frame today / this week / this month** | the **Today** / **Week** / **Month** buttons (next to Fit) — smoothly frame that period and show the "now" line |
| **Pan** | Drag any empty area, or `Shift` + scroll, or the `←` `→` `↑` `↓` keys |
| **Jump to start / end** | `Home` / `End` |
| **Overview** | The **minimap** at the bottom shows the whole project; the bright box is what's on screen — click or drag it to jump there |

Zoom is cursor-anchored and eases smoothly, and a project auto-fits when you open it, so
even multi-year plans are easy to navigate.

### Export to a calendar or to Microsoft Project

**Export** in the project toolbar (or **Export…** in the gear menu on a phone) offers two
downloads. Every member of the project can use them; nothing is changed by exporting.

- **Calendar (.ics)** for Outlook, Google Calendar and Apple Calendar. Choose every event or key
  milestones only. Entries show as free time, so a long phase does not block anyone's calendar,
  and each keeps the same ID so a newer file should update entries rather than add copies. A key
  milestone appears as a one-hour entry, marked ◆, ending when the work ends.
- **Microsoft Project (.xml)**, the interchange format that Microsoft Project, ProjectLibre,
  GanttProject, Smartsheet and others open. In Microsoft Project use File ▸ Open and choose the
  XML file type. Tracks become summary tasks, events become tasks, and dependencies become
  finish-to-start links. Tasks are set to manual scheduling so your dates open unchanged; switch
  them to automatic scheduling in Project when you want it to take over. Dates are written in
  your browser's time zone. Members, colours and comments do not travel; to-do items go into each
  task's notes.

### Status report (one page for leadership)

**Status report** in the project toolbar opens the print tool with a page already filled in from
the schedule: a status (on track / at risk / off track) derived by rule, a drafted headline, five
numbers, a simplified timeline with your key milestones, what finished recently and what is due
next, and your top risks.

- **Everything is editable, right there.** Click any text on the page to reword it. Use the panel
  to switch blocks on and off, reorder them, add your own numbers or a free-text block, hide tracks,
  and pick which milestones this audience sees.
- **Committed finish date.** Set it in the panel. The forecast is measured against it, and it is
  what turns the status amber or red. You can overrule the derived status, but you must say why,
  and the reason is printed in the footer.
- **Key milestones.** Tick **Key milestone** in an event's editor. They show as diamonds on the
  timeline and on the report.
- **Two layouts:** a 16:9 slide and a portrait handout (Letter or A4) that adds a milestone table.
- **Print / Save as PDF** produces a single vector page. In the print dialog choose "Save as PDF",
  margins "None", and turn on background graphics. The slide PDF drops straight into a deck.
- **Baseline (optional).** Plans should change, and by default a report shows only where the
  project stands today. For the audiences that need the history, **Set baseline** under
  **Baseline and limits** freezes today's dates as the approved plan. Setting one shows nothing by
  itself. On a report where you tick **Show changes against the baseline**, the report shows: an outlined strip above any track that moved,
  a hollow diamond where a milestone used to be with the slip in its label, and baseline, forecast
  and slip columns in the handout's table. Re-baseline when the plan is formally changed; old
  baselines are kept. With no committed date, the baseline's finish is what the forecast is
  measured against.
- **Limits.** The same section holds the project's limits for the status rule: how late is off
  track, and how far work may trail time before the project is at risk. Agree them with your
  sponsor before anything slips. Blank uses the default.
- **What moved (optional).** Once a report has been saved, tick **Show what moved since last
  report** to add a drafted "Moved since" line under the timeline. Reword it like any other text.
- **Milestone trend chart** (handout). After two saved reports you can add a chart of how far each
  milestone has drifted from the date first reported. A line that keeps climbing is a date that
  slips a little every time.
- **Download PowerPoint** gives you an editable `.pptx` of the page exactly as you see it, edits
  included: real text boxes, a grouped timeline made of shapes, and a real table on the handout.
  Paste the slide into your own deck and it picks up that deck's fonts. Nothing is saved by
  downloading.
- **Save report** keeps a dated copy. The next report for that project starts from its shape and
  shows whether the status moved. If the page gets too full it tells you what to cut; it never
  shrinks the type.

Viewers and commenters can open, print and download a report; owners and editors can edit and save.

## 4. Templates

Templates create a fully-formed project — categories plus sample timed tasks (with
dependencies) shifted to a start date you choose.

- **Use one:** dashboard → **From Template** → choose a template, set name/start, optionally
  assign to another user → **Create**.
- **Built-ins:** business plans (*Startup MVP*, *Seed Fundraising Round*, *Go-to-Market Launch*, *Hire a Key Role*, *Quarterly OKR Cycle*, …),
  work plans (*Two-Week Sprint*, *Product Launch*, *Event Plan*), and hobby builds (*Homebrew a Batch of Ale*, *First Marathon*, *Build a Steel-String Acoustic*, …).
- **Save your own:** open a project → **Save as Template** in the toolbar. Saved templates
  are private to you and appear alongside the built-ins in the **From Template** picker
  (delete them there).

## 5. Teams

Teams are reusable groups of people, so you can add a whole group to a project at once.

- **Manage teams:** **Teams** link in the dashboard header → **+ New Team**, then add/remove
  members by email or username. Teams are private to you.
- **Add a team to a project:** in a project's **Members** panel (owner-only), pick a team
  and a role, then **Add team** — every current member of that team is added to the project
  at that role.
- It's a **one-time add**: editing the team afterward doesn't change projects it was already
  added to.

## 6. Members & access

Owners control who can see/edit a project from the **Members** panel — open it from the
project's toolbar **or** the **Manage access** (👥) button on its dashboard card. From there:

- **Add a person** by email/username at a privilege: **Read only** (viewer) or **Read &
  edit** (editor).
- **Add a team** — every current member of that team is added at the chosen privilege.
- **Change** a person's privilege or **remove** them (the last owner can't be removed/demoted).

## 7. Admin console

Superusers can use Django's admin at `/admin/` for back-office management of users,
projects, memberships, teams, templates, categories, and events. It bypasses the in-app
role rules (full access) and is a separate login from the app. Create a superuser with
`manage.py createsuperuser`, or promote an existing account (`is_staff` + `is_superuser`).
