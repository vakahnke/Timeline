<!--
  Copy this file to docs/design/<feature-slug>.md and fill it in.
  Delete these HTML comments and any sections that genuinely don't apply.
  The goal: enough to DECIDE whether to build — not a spec of every detail.
-->

# <Feature Name> — Design Document

**Status:** Draft
<!-- Draft · Approved · Building · Shipped · Deferred · Dropped.
     "Approved" means the design is agreed but implementation is NOT started.
     A doc can sit at Draft or Deferred forever — writing it is not a commitment to build. -->
**Last updated:** YYYY-MM-DD
**Scope:** <one sentence — what part of the app this touches>

---

## 0. Problem / motivating requirements

<!-- Why this, why now, who it's for. Prefer concrete requirements/user stories over solutions.
     If a requirement is already satisfied today, say so (and where) so we don't rebuild it. -->

## 1. Current state (grounding)

<!-- How the relevant code works TODAY, with file references (e.g. backend/events/models.py,
     frontend/src/components/Timeline.jsx). This is what keeps the design honest and estimable.
     Claude fills this in by reading the code. -->

## 2. Prior art / research

<!-- How comparable tools (Linear, Asana, Notion, Monday, Gantt tools, …) handle this, and the
     one or two findings that actually shape our design. Claude can fan out research agents here. -->

## 3. Proposed design

<!-- The target design. Include only the layers this feature touches: -->

- **Data model** — new/changed models, fields, migrations.
- **API** — endpoints, request/response shape, who can call them.
- **UI / UX** — screens, interactions, states. For timeline/visual features, link a mockup or
  an interactive artifact rather than describing pixels in prose.
- **Permissions impact** — new roles/checks, or how it fits [PERMISSIONS.md](../PERMISSIONS.md).

## 4. Alternatives considered

<!-- The other approaches weighed and why they lost. Cutting an option here saves re-litigating later. -->

## 5. Phasing

<!-- Slice it so value can ship incrementally and cheaply. -->

- **Phase 1 (MVP):** the smallest version worth shipping.
- **Phase 2:** …
- **Later / maybe:** …

## 6. Cost & risk

<!-- What turns "here's a design" into "here's a design I can decide on." Be rough but honest. -->

- **Effort:** <t-shirt size per phase — S / M / L>
- **Migration / data risk:** <none | reversible | one-way — call it out>
- **Perf / UX risk:** <esp. anything touching the timeline hot path>
- **Blast radius:** <what existing behavior could this break>

## 7. Open questions / decisions needed

<!-- The calls that are YOURS to make before (or during) a build. Keep this list current. -->

- [ ] …
