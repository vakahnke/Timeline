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

The dashboard lists every project you're a member of, each with a **role badge**.

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
- **Move:** drag an event left/right to reschedule; drag it onto another track to
  recategorize.
- **Resize:** drag either edge.
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
| **Pan** | Drag any empty area, or `Shift` + scroll, or the `←` `→` `↑` `↓` keys |
| **Jump to start / end** | `Home` / `End` |
| **Overview** | The **minimap** at the bottom shows the whole project; the bright box is what's on screen — click or drag it to jump there |

Zoom is cursor-anchored and eases smoothly, and a project auto-fits when you open it, so
even multi-year plans are easy to navigate.

## 4. Templates

Templates create a fully-formed project — categories plus sample timed tasks (with
dependencies) shifted to a start date you choose.

- **Use one:** dashboard → **From Template** → choose a template, set name/start, optionally
  assign to another user → **Create**.
- **Built-ins:** *Two-Week Sprint*, *Product Launch*, *Event Plan*, *Custom Shop Build*,
  *MTA Rapid Prototyping (OTA)*.
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

## 6. Members

In a project, owners open **Members** to:

- **Invite** an existing user by email/username at a role.
- **Add a team** (above).
- **Change roles** or **remove** members (the last owner can't be removed/demoted).

## 7. Admin console

Superusers can use Django's admin at `/admin/` for back-office management of users,
projects, memberships, teams, templates, categories, and events. It bypasses the in-app
role rules (full access) and is a separate login from the app. Create a superuser with
`manage.py createsuperuser`, or promote an existing account (`is_staff` + `is_superuser`).
