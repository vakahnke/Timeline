# Probabilistic Schedule — Design Document

**Status:** Draft
**Last updated:** 2026-07-12
**Scope:** Show, per event and per project, a **probability/health that work finishes on time** that
**drops as a deadline approaches with tasks still open**, plus the **factors** that raise or lower it.

---

## 0. Problem / motivating requirements

Today the timeline is **deterministic**: an event is a fixed bar, the critical path is computed, and
either you're "on the date" or you're not. Vincent's ask:

1. **On-time probability that decays with time.** "The closer we get to the end of an event without
   its tasks complete, the lower the probability of finishing on time." As *today* advances and open
   work remains, the number should fall on its own.
2. **The "relations."** Surface the **factors that correlate with a higher or lower** probability of
   finishing on time (blocked tasks, critical-path position, overdue checkpoints, overload, …) — so a
   manager sees *why*, not just a bare number.

**Non-goals (v1):** a contract-grade calibrated percentage; resource-leveling/auto-scheduling;
changing how events or the critical path are drawn.

---

## 1. Current state (grounding)

Mapped from the code (`backend/events/models.py`, `backend/events/serializers.py`,
`frontend/src/components/Timeline.jsx`). **This section is the design's main constraint — most
textbook methods assume data we don't store.**

**What we have:**
- **Event** — `start`, `end` (DateTimes ⇒ a planned duration = `end − start`), `depends_on` (a
  self-referential predecessor DAG), `category`, `percent_complete` (manual 0–100).
- **Task** — `status ∈ {todo, in_progress, blocked, done}`, optional `due_date`, `assignee`/`owner`,
  `order`, `created_at`.
- **CPM already computed client-side** (`Timeline.jsx` forward/backward pass → ES/LS/EF/LF, float,
  `criticalEventIds`/`criticalLinks`). Backend does **zero** scheduling.
- Event API rollups `task_count` / `tasks_done`; the tasks API returns status + `due_date` + the
  parent event's `start`/`end`.

**What we DON'T have (the gaps that shape everything):**
1. **No task completion timestamps or status-change history.** Task has only `created_at` — no
   `completed_at`, no `updated_at`, no audit/transition log anywhere. ⇒ we cannot measure cycle time,
   throughput, aging, or rework, and **can't backfill** — that history only exists if we start writing it.
2. **No stored project target/baseline date.** "Planned end" is just `max(event.end)`, which **moves
   whenever anyone edits an event** (and note the recent *"shift task due dates when an event is
   dragged"* behavior). So **"on time vs. *what*?" is undefined** — there's no frozen commitment to
   measure against.
3. **No duration uncertainty** — one deterministic `end − start` per event; no three-point estimates,
   no variance.
4. **No history of finished projects** ⇒ no base rates, no way to *calibrate* or *learn* weights.
5. **Thin dependency model** — finish-to-start only, no lag/lead or dependency types.

**Consequence:** the rigorous statistical methods (throughput Monte Carlo, earned-schedule SPI(t),
cycle-time percentiles, reference-class priors, learned weights) are **not buildable today** — but they
become buildable a few weeks after we start logging a couple of timestamps. So the design is a **ladder**:
a defensible heuristic now, the statistical tier once data accrues.

---

## 2. Prior art / research

Five parallel research streams (scheduling engines, flow/throughput forecasting, schedule-slip risk
factors, probability UX, and this codebase). Full briefs are archived; the load-bearing findings:

**The three quantitative streams independently converged** on the same v1 shape: with no history, don't
simulate — **re-project remaining work from *today*** and squash it to a score.

- **Scheduling engines (Monte Carlo / PERT).** The event DAG *is* the network these tools need; only
  duration **uncertainty** is missing. The cheap, no-simulation core is **PERT + Central Limit**: reduce
  each event to a mean/variance `(μ, σ²)`, roll up the DAG, and read `P(finish ≤ deadline) = Φ((T−μ)/σ)`.
  Full Monte Carlo is *cheap* here (tens of nodes) but only *needed* for criticality-index / tornado
  charts → defer. **Fever charts** (Critical Chain) are the closest published analogue to "probability
  drops as the deadline nears while tasks are open."
- **Flow / throughput forecasting** ("When Will It Be Done?", Vacanti/ActionableAgile). The direct
  engine — a **"how many items done by date D" throughput Monte Carlo** — *needs completion-timestamp
  history we don't have.* Its no-history fallback is a **required-rate-vs-achieved-rate ratio** (§3.1).
  Caution: events have few tasks each, so anything statistical is **only credible at the project level**,
  and **`blocked` = "flow debt"** deserves a heavier penalty than `todo`.
- **Risk factors ("relations").** A catalog of measurable signals (§3.2), split into *computable today*
  vs. *needs history*. Key math: **earned-schedule SPI(t) = ES/AT** (use this — **classic SPI is a trap**;
  it → 1.0 at completion even on a late project); **Bayesian Beta-Binomial** updating as sub-deadlines
  resolve; combine factors via a **logistic**, but weights can only be *learned* once we have outcome
  history — until then, hand-set and label it a heuristic.
- **UX.** The market splits into **RAG dots** (Linear/Asana/monday — simple, manager-readable, but
  self-reported and sandbag-prone) and **probabilistic** (MS Project+FullMonte, Primavera — rigorous but
  heavy/specialist). **Differentiator: no lightweight *visual/canvas* PM tool overlays probability on the
  timeline bars themselves.** Winning recipe for non-statisticians: **computed** (not hand-set) RAG **+ a
  bucketed/ranged probability + a one-line "why" + a trend** — never decimals, never alarm-fatigue.

---

## 3. Proposed design

A two-tier model on a data foundation, surfaced progressively on the canvas.

### 3.1 The score — v1 heuristic (no history required)

Per event, compute an **on-time health score `p ∈ (0,1)`** that behaves exactly as asked — it falls as
*today* approaches `end` with work open. Intuition: **is the pace we've achieved enough for the work
that's left in the time that's left?**

```
# effective progress (status-weighted; blocked counts as barely-started "flow debt")
w(done)=1.0, w(in_progress)=0.5, w(blocked)=0.25, w(todo)=0
p_eff   = Σ w(task) / N                     # N = task count on the event
elapsed = clamp((now - start) / (end - start), 0..1)

r_done  = p_eff              / max(elapsed, ε)      # progress achieved per unit time
r_need  = (1 - p_eff)        / max(1 - elapsed, ε)  # progress still required per unit time
rho     = r_done / r_need                            # >=1 ⇒ current pace suffices
p_event = 1 / (1 + e^(-k · (rho - 1)))               # logistic squash, k ≈ 2–4
```

As `now → end` with tasks open, `r_need → ∞`, `rho → 0`, `p_event → 0`. **That is the requested decay,
with zero history.** Events with no `due`/task signal return **"insufficient data" (gray)**, not a number.

**Project rollup:** do **not** multiply per-event probabilities (dependent events are correlated). Instead
reuse the **existing CPM**: the first-order signal is **`deadline − critical-path forecast finish`** (slack);
combine it with the weakest events *on or near the critical path*. Off-critical-path trouble barely counts.

### 3.2 The "relations" — factor catalog (this is Vincent's second ask)

Each factor adjusts the score and, more importantly, **feeds the "why."** Split by feasibility:

**Computable today** (events + dates + DAG + CPM + task status + due dates + assignee):

| Factor | Dir. | Meaning |
|---|---|---|
| Critical-path finish vs. deadline (**slack**) | ↑ if slack | first-order signal; if the CP already lands late, `p` is low before anything subtle |
| Criticality / near-critical (float) | amplifier | weight every other factor by how close to the critical path it is |
| **Schedule-adherence** = due-tasks-done / due-tasks-so-far | ↑ | native earned-schedule proxy: "are we hitting the checkpoints we set?" |
| **Blocked** tasks (esp. on CP) | ↓ | stalled throughput; strongest cheap risk signal |
| **Overdue** tasks (`due < today && ≠ done`) | ↓ | earliest realized evidence of slip |
| Open tasks bunched **near the deadline** | ↓ | crunch; low odds all land |
| **WIP** (`in_progress` count) / **assignee overload** (in_progress per person) | ↓ | high WIP → longer cycle time (Little's Law); multitasking cost |
| Dependency fan-in / fan-out; **depends on an already-late item** | ↓ | inherits/propagates risk along the DAG |

**Needs the data foundation (§3.3) → v2:** earned-schedule SPI(t), work-item **age**, **rework/reopened**
counts, estimate accuracy, throughput/cycle-time percentiles, reference-class base rate.

### 3.3 Data foundation — the prerequisite (small, forward-only, do first)

Two cheap additions unlock the entire statistical tier. **Every day we wait is history we can't backfill:**

1. **Task status-transition log** — a `TaskStatusEvent(task, from, to, at, by)` row written on each status
   change (or `django-simple-history` on `Task`). Unlocks: `completed_at`, cycle time, aging, throughput,
   rework, estimate accuracy. *(Also fixes that `Task` has no `updated_at`.)*
2. **Project target date + baseline** — a stored `Project.target_date` (the commitment "on time" is
   measured against) and optionally a `baseline` snapshot of planned event dates at kickoff (so we can
   tell a *recovered plan* from *moved goalposts*).

Neither changes existing behavior; both are strictly additive.

### 3.4 API / where it computes

- **v1 heuristic: client-side**, alongside the existing CPM in `Timeline.jsx` (same inputs: events, dates,
  DAG, tasks). Cheap, no backend change, updates live as tasks/dates change. A single `useMemo` producing
  `{ perEvent: {id → {p, band, drivers[]}}, project: {p, band, drivers[], forecastFinish} }`.
- **v2 statistical: backend**, once history exists — a periodic job computing SPI(t)/throughput Monte
  Carlo per project, exposed as `GET /projects/{id}/forecast/`.

### 3.5 UI / UX (canvas-first, manager-readable)

Following the UX stream's ladder; **all computed from data, shown as bands/ranges, always with a "why":**

- **v1 — per-event health dot + "why" tooltip + project gauge.** A small green/amber/red dot on each bar's
  left cap (reuse the arrows/lane **canvas** — cheap, Safari-safe, per [[safari-webkit-timeline-perf]]).
  Hover → *"~65% on time (medium) · 3/5 tasks done · 1 blocked · 2 due after this event ends · ▲ up from
  last week."* A project **on-time gauge/pill** in the toolbar with a trend arrow and a drill-down listing
  the 2–3 events dragging it down (a mini-tornado). **Buckets/ranges, never "73.4%."**
- **v1.1 — confidence-tail band.** A translucent, faded extension of the bar from its likely end to a
  pessimistic end — uncertainty rendered as *width*. The signature visual; drawn on the canvas.
- **v2 — cone of uncertainty / projection overlay** (Linear-style optimistic/pessimistic lines from *today*
  to the target line) and a **fever-chart panel** for project/portfolio buffer-burn.

### 3.6 Permissions impact

Read-only for anyone who can view the project. Setting `Project.target_date` = Editor/Owner (fits
[PERMISSIONS.md](../PERMISSIONS.md)); no new roles.

---

## 4. Alternatives considered

- **Full Monte Carlo now.** It's cheap computationally, but needs **duration uncertainty** (three-point
  estimates) or **throughput history** we don't have — so it'd be simulating made-up inputs. Deferred to
  v2, where it earns its keep by producing criticality/tornado charts the analytic method can't.
- **User-entered three-point estimates per event.** Real PERT rigor, but heavy input friction and
  estimators are overconfident (tails too narrow). Deferred; synthesize uncertainty from one global knob
  first.
- **Full Critical-Chain restructuring** (insert buffer events, aggressive durations). Too invasive to the
  model/UX; instead borrow only the **fever-chart** view in v2.
- **A single self-reported RAG status** (Linear/Asana style). Simplest, but sandbag-prone and adds no real
  forecasting — and we can *compute* it, which is strictly better.
- **Claiming a calibrated %.** Rejected for v1 on principle: we can't calibrate without outcome history
  (Brier/reliability). v1 is a **health/risk score**; it earns the right to a "probability" after the log
  has run a few project cycles.

---

## 5. Phasing

- **Phase 0 — Data foundation** *(do first; unblocks everything).* Task status-transition log +
  `Project.target_date`. No UI. Starts accumulating the history v2 needs.
- **Phase 1 — Heuristic score + minimal UI.** Client-side per-event/project score (§3.1) driven by the
  today-computable factors (§3.2); per-event health dot + "why" tooltip + project gauge. Labeled a
  *health estimate*.
- **Phase 1.1 — Confidence-tail band** on the bars (the distinctive canvas visual).
- **Phase 2 — Statistical tier** *(once ~weeks/a few project-cycles of log data exist).* Earned-schedule
  SPI(t) + EAC(t); throughput Monte Carlo → real P50/P80/P90 finish dates; cone/projection overlay;
  reference-class prior + Bayesian updating; **calibration tracking** before any precise number is shown.
- **Phase 3 — Portfolio.** Fever-chart / multi-project health roll-up.

---

## 6. Cost & risk

- **Effort:** Phase 0 **S** (a model + migration + a signal/serializer hook, + one project field). Phase 1
  **M** (a scoring `useMemo` + dot/tooltip/gauge on the existing canvas). Phase 1.1 **S**. Phase 2 **L**
  (backend forecasting job, Monte Carlo, new overlays, calibration). Phase 3 **M**.
- **Migration / data risk:** Phase 0 is **additive & reversible** (new table + nullable field; no
  backfill). Low.
- **Perf / UX risk:** v1 score is a small `useMemo`; the dot/band ride the **canvas** overlays we already
  built, so no new Safari-layer cost ([[safari-webkit-timeline-perf]]). Main UX risk is **false precision /
  alarm fatigue** — mitigated by buckets+ranges, computed (not hand-set) health, always-on "why", trend,
  and a dead-band.
- **Blast radius:** none to existing behavior — the score is read-only overlay + additive data. The honest
  risk is **credibility**: an un-calibrated number that's wrong erodes trust. Mitigation: frame as a health
  estimate, show the drivers, and don't promote to "probability" until calibrated.
- **Biases to disclose in the UI:** independence + single-critical-path assumptions make v1 **optimistic**;
  no baseline means edits can *look* like progress. Say so in a tooltip.

---

## 7. Open questions / decisions needed

- [ ] **"On time" against what?** A stored **`Project.target_date`** you set (recommended), or the live
      `max(event.end)`? Without a fixed target, the number is unanchored. *(This is the pivotal call.)*
- [ ] **Green-light Phase 0 now?** The status-transition log only pays off after it's been running — so if
      the statistical tier appeals *at all*, start logging early even if we don't build the UI yet.
- [ ] **v1 framing:** are you comfortable shipping a **health/risk score with a "why"** (not a calibrated
      "%")? The alternative is waiting for Phase 2 data before showing anything.
- [ ] **First visual:** health **dot + tooltip + gauge** (safe, manager-readable) vs. leading with the
      **confidence-tail band** (flashier, more clutter risk)?
- [ ] **Status weights & `k`** (done/in_progress/blocked/todo = 1/0.5/0.25/0, logistic steepness) — sensible
      defaults, or expose as project settings?
- [ ] **Scope:** event-level scores only, or project-level too, in v1? (Project rollup leans on the CPM and
      is the more trustworthy number given small task counts per event.)
