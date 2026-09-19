# Design docs

Feature designs live here **before** they're built. Writing a design doc is **not** a commitment
to implement it — it's how we think a feature through and decide whether it's worth building.

This is the same pattern that produced [KANBAN.md](../KANBAN.md) and [PERMISSIONS.md](../PERMISSIONS.md),
just formalized so a design can sit and be revisited without any code being written.

## The flow

1. **Name a feature.** No code is touched yet.
2. **Research + draft.** Claude reads the relevant code to ground `## 1. Current state`, optionally
   fans out research agents for `## 2. Prior art`, and drafts the doc from [TEMPLATE.md](TEMPLATE.md).
3. **Review + iterate.** Read it on GitHub, refine the *design only*. Answer the open questions.
4. **Decide.** Set **Status**:
   - **Approved** — design agreed, ready to build when you choose (still not started).
   - **Deferred** — good idea, not now. It stays here.
   - **Dropped** — decided against; keep the doc as a record of why.
5. **Build only on the word "build it"** — and then phase by phase, not all at once. Nothing in a
   design doc triggers implementation on its own.

## Status lifecycle

```
Draft ──► Approved ──► Building ──► Shipped
  │           │
  ├──► Deferred (revisit later)
  └──► Dropped  (decided against)
```

Keep the `**Status:**` line at the top of each doc current — it's the fastest way to see, across
all docs, what's designed-but-unbuilt vs. shipped.

## When to use what

- **A design doc here** — anything you might want to sit on, revisit, or decide against later; or
  anything with a data model / migration / permissions impact. Durable and versioned.
- **Plan mode (in a Claude session)** — a quick "what would this take?" for a smaller change you'll
  likely act on in the same sitting. Claude stays read-only and produces a plan; no lasting file.
- **An interactive artifact** — for timeline/visual/UX-heavy features, where a static markdown
  under-serves the design. Review something close to the real feel before deciding.

## Conventions

- One file per feature: `docs/design/<feature-slug>.md` (e.g. `ical-export.md`).
- Follow [TEMPLATE.md](TEMPLATE.md). Delete sections that genuinely don't apply.
- Ground `## 1. Current state` in real file references so the design stays estimable.
- Prefer requirements over solutions in `## 0`; save the "how" for `## 3`.

## In flight / parked

<!-- Optional index. Update as docs are added so parked ideas stay visible. -->

- [status-one-pager.md](status-one-pager.md) — **Draft**. A leadership status report composed in the app
  and exported as a native PowerPoint slide and a print-ready PDF handout; derived status, baselines.
- [touch-timeline.md](touch-timeline.md) — **Shipped**. Make the timeline itself usable by touch: pointer
  events, pinch zoom, long-press to move, grab-dot resize, touch minimap.
- [probabilistic-schedule.md](probabilistic-schedule.md) — **Draft**. On-time probability/health that
  decays as deadlines near, + the factors driving it. Key constraint: needs a data foundation (task
  status-transition log + project target date) before the statistical tier is possible.

Already-designed features living elsewhere in `docs/`:
- [KANBAN.md](../KANBAN.md) — Phase A shipped; Phase B (manual reorder) pending.
- [PERMISSIONS.md](../PERMISSIONS.md) — Phases 1–3 shipped; Guest/external tier remains.
