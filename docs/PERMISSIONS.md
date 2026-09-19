# Permissions & Access Control — Design Document

**Status:** Phase 1 (live team access) + Phase 2 (provenance) + Phase 3 **Commenter** (event comments + the Commenter role) SHIPPED. Only the Phase 3 **Guest/external** tier remains. §1 audit, §2 research, §3 design below.
**Last updated:** 2026-07-12
**Scope:** Who can see and change projects, events, tasks, members, and teams.

---

## Where authority comes from

One rule, enforced on the server for every request:

> **Can this caller do this action on this project?** The access token says who the caller is.
> The permission class then loads that person's *current* access to *that* project from the
> database and allows or denies. Nothing the client sends is a source of authority.

- **The project is the unit.** Teams are only a way to grant project access in bulk. A team grant
  is resolved live through `get_role`, the highest grant wins, and a team can grant at most Editor.
- **Roles in a request are data, never credentials.** The member endpoints accept a `role` because
  an Owner is setting *someone else's* role; the caller's own right to do so is checked first,
  from the database. A `role`, `is_admin`, `is_staff`, `owner` or `project` field in any other
  body, a header such as `X-Role`, a query string, or an extra claim in a validly signed token is
  ignored. A tampered token is rejected outright.
- **Identity fields come from the token.** Comment authors, report authors, baseline creators and
  new-project owners are set by the server.
- **Access is read on every request.** Demoting or removing a member, taking someone off a team,
  removing staff status or deactivating an account takes effect on their very next request, even
  though their token is still valid. Tokens carry identity only, never permissions.
- **People on a task must have access to its project.** Owners and assignees are checked with the
  same `get_role`.
- **The React app hides controls as a courtesy, not as security.** `my_role` is sent to the client
  so it can grey out buttons; the server never reads it back.
- **The one global override:** staff accounts (`is_staff`) are org-admins and count as Owner on
  every project. That is a flag in the database, set only in the Django admin.

`backend/projects/tests_authority.py` attacks each of these points and must keep passing.

## 0. Motivating requirements

1. **Live team access.** When a project is assigned to a team, *every current member of
   that team* should have **at least read access** — and it should stay live: add someone
   to the team and they gain access; remove them and they lose team-derived access.
2. **Team owner manages membership.** The creator/owner of a team can add and remove that
   team's members.

Requirement 2 is **already satisfied** today (see §1.6). Requirement 1 is **not** — today's
"assign a team" is a one-time snapshot (see §1.5). This document audits the current model,
folds in how comparable products do it (§2), and proposes a target design (§3).

---

## 1. Current state (audit)

### 1.1 Entities

| Entity | Key fields | File |
|---|---|---|
| **User** | Django auth user. `is_staff` = org-admin; `is_active` = approved account | auth |
| **Project** | `owner` (FK), `members` (M2M *through* `ProjectMembership`) | `backend/projects/models.py:5` |
| **ProjectMembership** | `user`, `project`, `role`, unique per (user, project) | `backend/projects/models.py:106` |
| **Team** | `owner` (FK), `members` (M2M, **no per-member role**) | `backend/projects/models.py:82` |
| **Role** | text choices: `owner` > `editor` > `viewer` | `backend/projects/models.py:28` |

There is **no** stored link between a Team and a Project (see §1.5).

### 1.2 Roles

Three roles, ranked in `permissions.py:5`:

| Role | Rank | Intended capability |
|---|---|---|
| `owner` | 3 | Full access: read/write, member management, add-team, delete project |
| `editor` | 2 | Read + write events/categories/tasks; edit project metadata |
| `viewer` | 1 | Read only |

There is **no commenter/guest/external tier**.

### 1.3 The access chokepoint — `get_role(user, project_id)`

`backend/projects/permissions.py:14`. Returns the user's effective role for a project, or
`None`:

1. `None` if unauthenticated or no project.
2. `OWNER` if **org-admin** (`is_org_admin` = `user.is_staff`, `permissions.py:8`). Single
   predicate by design — one place to later move org-admin onto a dedicated flag.
3. Otherwise the user's `ProjectMembership.role`, or `None`.

**It has no notion of teams.** This is the core of the gap.

### 1.4 Permission classes (`backend/projects/permissions.py`)

| Class | Applies to | Rule |
|---|---|---|
| `IsProjectMember` | nested events/categories | SAFE → any member (Viewer+); write → Editor+ (`:31`) |
| `IsProjectOwner` | member mgmt, project delete | Owner only (`:59`) |
| `IsTeamOwnerOrReadOnly` | Team read/write | read → any team member/owner; write → **team owner only** (`:79`) |

### 1.5 How a team is assigned to a project today — **one-time snapshot**

`ProjectViewSet.add_team` (`backend/projects/views.py:210`), owner-only:

```
for user in team.members.all():
    ProjectMembership.objects.get_or_create(project=project, user=user, defaults={'role': role})
```

It **copies the team's current members into individual `ProjectMembership` rows** and stores
**no** team→project relationship (the `Team` docstring calls this out: *"a one-time
snapshot"*, `models.py:83`). Consequences:

- ❌ A person added to the team **later** gets **no** access to the already-assigned project.
- ❌ A person **removed** from the team **keeps** their project access.
- ❌ No record of *which* team granted access, or its role — can't be revisited or revoked as a unit.

### 1.6 Team membership management — **already correct**

- Backend: `TeamViewSet.add_member` / `remove_member` (`views.py:392`, `:406`) call
  `self.get_object()`, gated by `IsTeamOwnerOrReadOnly` → only the **team owner** may write.
- Frontend: `TeamModal.jsx` sets `canManage = creating || team.is_owner`; only the owner sees
  Add/Remove controls, members get a read-only view.

➡️ **Requirement 2 is met.** No change needed beyond whatever the redesign implies.

### 1.7 Project visibility — `ProjectViewSet.get_queryset` (`views.py:108`)

- Org-admins → **all** projects.
- Everyone else → projects where they have a `ProjectMembership` (subquery, so event
  aggregates aren't multiplied). **Team-only access would not show a project here** — another
  reason the snapshot approach was needed.

### 1.8 Guardrails already present

- **Last-owner protection:** can't remove or demote the sole `owner` membership
  (`member_detail`, `views.py:190`–`205`).
- **Creator becomes owner:** `perform_create` writes an `owner` `ProjectMembership`
  (`views.py:146`).
- **Owner-only actions** enumerated centrally (`OWNER_ONLY_ACTIONS`, `views.py:128`) because
  `get_permissions` overrides per-action `permission_classes`.

### 1.9 Gap summary

| # | Requirement | Status | Why |
|---|---|---|---|
| 1 | Team members get ≥ read access, live | ❌ **Broken** | snapshot copy; `get_role`/`get_queryset` ignore teams |
| 2 | Team owner manages members | ✅ Met | owner-gated backend + owner-only UI |

### 1.10 Latent issues to resolve in the redesign

- **Two grant sources will exist** (direct membership + team) → need a reconciliation rule
  (industry standard: *highest privilege wins*). Not needed today because there's only one
  source.
- **`Project.owner` FK vs `owner` membership row** partly overlap; decide the source of truth.
- **No commenter/guest tier** — evaluate against competitors (§2).
- **No way to view or revoke a team assignment**, or change the role a team was granted.
- **Org-admin == `is_staff`** — fine for now; keep the single-predicate seam.

---

## 2. How comparable products do it (research)

Synthesized from a study of **Asana, Monday.com, Jira, Linear, Notion, ClickUp, Trello** and
RBAC/ReBAC literature (OWASP, Oso, Auth0, ZITADEL, Kubernetes, Google Zanzibar). Full source
lists are in §2.5.

### 2.1 Cross-product comparison

| Product | Project/board role ladder | Team → resource access | Multi-grant conflict rule | Guest tier |
|---|---|---|---|---|
| **Asana** | Admin · Editor · Commenter · Viewer | **Live** ("indirect membership") | **Highest-privilege-wins** | Yes, per-project, not billed as seat |
| **Monday** | Edit-all · Edit-content · Edit-assigned · View+comment | Subscribe team to board — **retroactivity weak/ambiguous** | Most-*restrictive* across nested layers | Yes, per-board (~4/seat) |
| **Jira** | Permission scheme → project **roles** (Admins/Developers/Users) | **Live** via role/group membership | Additive (highest wins), no deny | Via groups; JSM has portal customers |
| **Linear** | Workspace Owner/Admin/Member/Guest + **Team Owner** | **Live** — team membership *is* the boundary | Additive union of team memberships | Yes, pinned to specific teams |
| **Notion** | Full · Edit · Comment · View | **Live** teamspaces + reusable **Groups** | **Broadest-access-wins** | Yes, per-page, not a seat |
| **ClickUp** | Full-Edit · Edit · Comment · View | **Live** — share a Space to a **Team** | Most-*specific* container wins | Yes, per-item, free view-only pool |
| **Trello** | Board Admin · Normal · Observer(read/comment) | Workspace-visible boards auto-grant | Board visibility + explicit membership | Yes, board guests |

### 2.2 Points of consensus (adopt these)

1. **Team → resource access is computed LIVE, never copied.** Asana, Jira, Linear, Notion,
   ClickUp all dereference current team membership at check time. Monday is the cautionary
   counter-example: its looser "subscribe" model produces exactly our bug ("why can't my new
   hire see the board?"). **Our snapshot approach (§1.5) is the known antipattern.**
2. **The team-on-a-resource assignment carries a role there.** A team/group has *no inherent
   power*; the project decides (Jira roles get meaning per-project; ClickUp shares a Space to
   a Team *at a grade*; Asana adds a team *at an access level*). So the same team can be
   Editor on Project X and Viewer on Project Y.
3. **Reconcile multiple grants with highest-privilege-wins** (Asana "highest wins", Notion
   "broadest wins", Jira/Linear/Auth0/ZITADEL/Kubernetes additive union). A direct Editor who
   is also in a Viewer team gets **Editor** — a broad team grant must never *downgrade* an
   explicit one.
4. **Two independent axes: project role vs org/workspace admin tier.** Everyone separates
   "what can you do on this project" from "are you a workspace admin (provisioning, billing,
   team management)." Don't overload "Owner."
5. **A Comment-only tier is near-universal** (Asana Commenter, Monday View+comment, Notion/
   ClickUp Comment, Trello Observer) — standard for stakeholder review without edit rights.
6. **Guests are project-scoped, cheaper, and can't administer or be added via a team.** All
   seven keep external guests explicit-share-only and out of the admin/team plane.
7. **Show *why* someone has access.** Asana tracks direct vs. indirect membership so admins
   can tell "Editor (via Design team)" from "Editor (invited directly)" — essential for
   auditing and revocation.

### 2.3 Ideas we deliberately DON'T copy

- **Jira's permission-scheme indirection** (schemes → roles → people, schemes reused across
  projects) is powerful for hundreds of centrally-governed projects but heavy machinery for a
  small app. We get the reuse we need from **Teams** (assign one team to many projects), not
  from a scheme abstraction.
- **A standalone ReBAC engine** (Zanzibar/SpiceDB/OpenFGA). The guidance is explicit: adopt
  one only with implicit hierarchy analysis + heavy filter-query load. We steal the *ideas*
  (uniform grant tuple, live two-hop dereference, ordered roles + `max`) on a plain SQL join.
- **Deny/negative grants** (AWS/NTFS style). Additive-only is simpler to reason about and
  audit; add explicit deny later *only* if per-user exclusion from a team grant is ever needed.
- **Monday's "most-restrictive across nested layers."** That's a different axis (an admin
  clamping access down). We resolve *among grants on the same project* → highest wins. If we
  ever want an admin cap, it'd be a separate, explicit mechanism.

### 2.4 RBAC/ReBAC backbone (the theory we build on)

- **Uniform grant primitive:** model every grant as `(project, subject, role)` where
  `subject ∈ {user, team}`. Individual and team shares become one table, one code path — a
  team is just another grantee whose members expand at check time (the Zanzibar
  `object#relation@user|userset` shape).
- **Ordered role ladder** so inheritance is free and `max()` is well-defined:
  `Viewer ⊂ Editor ⊂ Owner` (with `Commenter` sittable between Viewer and Editor later).
- **Additive union / most-permissive-wins** across all grant sources (Auth0, ZITADEL, K8s).
- **Foundational controls:** default-deny (OWASP A01 — Broken Access Control is #1), least
  privilege (read is the floor for shared resources), enforce server-side, protect the last
  owner, and close self-escalation holes.

### 2.5 Sources

Full findings and URL lists are archived from the four research passes. Key references:
Asana permissions overview & individual-project/team permissions; Monday board & account
permissions; Jira permission schemes & project roles; Linear members-roles, teams, private
teams; Notion sharing/teamspaces/groups; ClickUp roles/guests/sharing; Trello board
permissions/observers; OWASP Authorization Cheat Sheet & Top-10 2025 A01; Oso RBAC/ReBAC;
Auth0 & ZITADEL additive RBAC; Kubernetes RBAC; Authzed/Aserto/Permit on Google Zanzibar.

---

## 3. Proposed design

### 3.1 Design principles (adopted)

**P1 — Live, never copied.** Team access is evaluated from *current* membership at request
time. **P2 — Graded team assignment.** A team is assigned to a project *with a role there*.
**P3 — Most-permissive-wins.** Effective role = the highest across all grant sources.
**P4 — Two axes.** Project role (Owner/Editor/Viewer) is separate from the org-admin tier
(`is_staff`). **P5 — Additive only** (no deny). **P6 — Default-deny, least-privilege,
server-side.** **P7 — Show provenance** (direct vs. via which team).

### 3.2 Target role ladder — **keep Owner/Editor/Viewer now**

| Role | Rank | Capabilities |
|---|---|---|
| Owner | 3 | Everything: read/write, manage members & team assignments, delete project |
| Editor | 2 | Read + create/edit/move events, categories, tasks; edit project metadata & reschedule |
| Viewer | 1 | Read only |

**Decision — defer Commenter and Guest** (recommended):
- **Commenter** is validated by every competitor, *but the app has no comment feature yet*, so
  a Commenter role would today be indistinguishable from Viewer. Add it the moment we ship
  comments on events/tasks — the ladder is designed to accept it between Viewer and Editor.
- **Guest (external)** implies external identity + billing/seat rules well beyond this change.
  Design keeps the door open (guests must be **project-scoped, never team-scoped**) but we
  don't build it now.

This keeps the change focused on the actual requirement (live team access) without inventing
tiers we can't yet exercise.

### 3.3 The grant model — one new table

Introduce a **graded team↔project assignment** (the P1/P2 primitive). Direct membership stays
as-is (`ProjectMembership`); the new object is its team-shaped sibling:

```
ProjectTeam
  project   FK → Project      (related_name='team_links')
  team      FK → Team         (related_name='project_links')
  role      viewer | editor   (see cap, §3.6)   default: viewer
  added_by  FK → User (nullable, audit)
  added_at  datetime
  UNIQUE (project, team)
```

Conceptually the union of `ProjectMembership` and `ProjectTeam` *is* the grant set
`(project, subject, role)` with `subject ∈ {user, team}`.

### 3.4 Effective-role algorithm (`get_role`)

Replace the single-source lookup with a most-permissive union:

```
ROLE_RANK = {viewer:1, editor:2, owner:3};  RANK_ROLE = inverse
get_role(user, project_id):
    if not authed or project_id is None:      return None
    if is_org_admin(user):                    return OWNER          # unchanged seam
    ranks = []
    m = ProjectMembership(user, project_id)                          # direct grant
    if m: ranks.append(RANK[m.role])
    for r in ProjectTeam.role
            where project_id
              and team has `user` as member OR owner:                # live two-hop
        ranks.append(RANK[r])
    return RANK_ROLE[max(ranks)] if ranks else None                  # highest-wins / default-deny
```

Every existing permission class (`IsProjectMember`, `IsProjectOwner`) already routes through
`get_role`, so they inherit team-awareness for free — the change is localized.

> **Team membership = `team.members` ∪ `{team.owner}`.** A team owner isn't auto-added to
> `members`, and it would be surprising for them to lack access to a project their own team is
> on. Including the owner also matches "the team's people."

### 3.5 Project visibility (`get_queryset`)

Currently lists only projects where the user has a `ProjectMembership`. Extend to the union:

```
visible = projects where (
    id ∈ ProjectMembership(user).project_ids
  ∪ id ∈ ProjectTeam.project_ids where team has user as member/owner
)
```

Keep the subquery style (no join fan-out) so the event aggregates aren't multiplied; add
`.distinct()`.

### 3.6 Team-assignment role is capped at **Editor**

**Decision (recommended):** a team can be assigned **Viewer or Editor**, not Owner. Rationale:
ownership (delete the project, manage members, transfer) is an individual responsibility, and a
"team of owners" is a footgun — anyone editing that team's roster elsewhere could grant
project-deletion rights to a stranger. This also keeps the **last-owner invariant meaningful**
(§3.7). It still satisfies the requirement ("read access at the very least"). Owners are always
granted directly, per-person. *(Open question 3.11-A if you want to allow team-Owner.)*

### 3.7 Guardrails

- **Last-owner protection counts DIRECT owners only.** A team-derived owner is too fragile to
  rely on (a roster edit elsewhere could orphan the project). With the §3.6 cap this is
  automatic — team grants never confer Owner — and the existing check (counts `owner`
  `ProjectMembership` rows, `views.py:190`) already has the right semantics.
- **No self-escalation:** acting identity always from the JWT, never a request-body `role`;
  a user can't change their own role; nobody can grant a role above their own. (Today only
  Owners manage members and Owner is the ceiling, so this largely holds — re-verify when
  adding the assign-team-role path.)
- **Assigning/removing a team, and editing a team roster, are privileged and live-affecting.**
  Keep roster edits team-owner-gated (already true). Surface a **"this team is assigned to N
  projects"** warning before roster edits, since one change ripples across projects.
- **Default-deny, server-side** — unchanged and preserved.

### 3.8 API surface

| Method | Path | Who | Change |
|---|---|---|---|
| POST | `/projects/{id}/add-team/` | project Owner | **Change:** upsert a `ProjectTeam` link (idempotent; update role if exists). Stop snapshot-expanding into memberships. |
| GET | `/projects/{id}/teams/` | any member | **New:** list assigned teams (name, role, member count/names). |
| DELETE | `/projects/{id}/teams/{team_id}/` | project Owner | **New:** un-assign a team. |
| GET | `/projects/{id}/members/` | any member | **Extend:** return direct members *and* team-derived access with provenance (`via_team`). |

`add_member`/`member_detail`/team CRUD/`add_member`·`remove_member` on teams: **unchanged**
(requirement 2 already met).

### 3.9 UI changes

- **MembersPanel:** add an **"Assigned teams"** section (team name · role · member count · Remove
  for owners), replacing the current "added N members" snapshot toast. In "Who has access,"
  label team-derived rows **"Editor · via Design team"** and make them non-removable
  individually (you remove the *team* or edit its roster).
- **TeamModal:** when the owner edits a roster, show **"Changes apply to N projects this team
  is on."**
- **No change** to who sees the controls (owner-gated already).

### 3.10 Migration & back-compat

- Add `ProjectTeam` + migration. **No data migration.**
- **Existing snapshot memberships stay as direct grants** — they keep working; we can't
  reliably tell which membership a past `add_team` created, so we don't auto-convert. Going
  forward, assignments are live links. Owners may prune redundant direct grants after
  re-assigning via a team (optional, manual).
- Fully backward compatible: `get_role` is a superset of today's behavior (adds a second grant
  source); nobody loses access.

### 3.11 Open questions for sign-off

- **A. Team-Owner grants:** cap team assignments at Editor (recommended, §3.6), or allow a team
  to be assigned Owner?
- **B. Commenter tier:** confirm deferring until a comments feature exists (recommended), or
  add a no-op Viewer-plus-comments placeholder now?
- **C. Provenance depth:** is "Editor · via Design team" enough, or do we also want a per-user
  "why do I have access" breakdown?
- **D. Cleanup:** do anything about pre-existing snapshot memberships, or leave them
  (recommended)?

### 3.12 Phased implementation plan

- **Phase 1 — core (satisfies the requirement).** `ProjectTeam` model + migration;
  `get_role` union; `get_queryset` union; `add-team` → upsert link; `DELETE team` + `GET teams`;
  tests for live add/remove propagation and highest-wins. *Backend-complete on its own.*
- **Phase 2 — UI & provenance. ✅ SHIPPED.** MembersPanel "Assigned teams" section +
  unified "Who has access" with per-person provenance ("Editor · via USRCO", "Owner ·
  org-admin", locked) via `GET /projects/{id}/access/`; roster-edit "N projects" warning
  (`assigned_project_count`). (Change-team-role: unassign + re-add for now.)
- **Phase 3 — tiers.** ✅ **Commenter SHIPPED** — event comment threads
  (`/projects/{id}/events/{eid}/comments/`, Commenter+ to post via `IsProjectCommenter`) + the
  Commenter role in the ladder (Viewer < Commenter < Editor < Owner). Guest/external sharing
  still pending.

Each phase is independently shippable; Phase 1 alone closes the audit gap.
