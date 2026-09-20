# Closing out a run: what it cost and how well it worked — Design Document

**Status:** Phases A and B built (2026-09-20); phase C waits for library phase 2
**Last updated:** 2026-09-20
**Scope:** A short, optional close-out when a project finishes, and what a template then shows from the close-outs of its runs. Touches the project model and API, the project page, and the template library's track record.

---

## 0. Problem / motivating requirements

Time is the objective the schedule can measure, and the template library already measures it:
a template shows how many runs finished and how they ran against the plan. But a plan that
finishes on time can still be the wrong plan. Two things matter as much and cannot be computed
from dates: **what that run cost**, and **how well it worked**.

- **R1. Capture it once, at the right moment.** When a project is done, ask its owner three
  things: what it cost, how well the plan worked, and what they would change. Under a minute.
- **R2. Optional, every part of it.** A run can be closed out with any subset, or not at all.
  Nobody is nagged twice.
- **R3. The template learns.** A template shows cost and outcome the way it shows time: as
  totals across its runs, e.g. "typically costs about $14,000 · worked in 9 of 11 runs".
- **R4. The same privacy promise as the track record.** Totals only, a minimum number of runs
  before anything is shown, never which project or whose, and a run can stay out of it. Cost is
  more sensitive than dates, so the bar is at least as high.
- **R5. It rates the plan, not the people.** Neutral wording. This is not a performance review
  and must not read like one (same spirit as keeping plan-change features opt-in).
- **R6. Stopping early is an answer.** A run that was abandoned or cancelled is the most useful
  thing a template can learn from. Closing out must not require reaching 100%.
- **R7. Lessons flow back to the plan.** "What I would change" should reach the template's owner
  and, with phase 2 of the library, seed the "what I learned" note on the next version.

Not in scope: budgets, cost tracking during the project, timesheets, invoices, currency
conversion, or a formal project closure report.

## 1. Current state (grounding)

- **Nothing reacts to a project finishing.** Progress is an average computed for the dashboard
  (`avg_progress` in `ProjectViewSet.get_queryset`, `backend/projects/views.py`); no code path
  notices 100%, and the project page has no "finished" state.
- **Provenance exists** (since the template library): `Project.source_template_key`,
  `source_template_span` and `count_in_track_record` (`backend/projects/models.py`).
- **The track record** is `library.track_records` (`backend/projects/library.py`): one grouped
  query over projects by template key, returning `started`, `finished`, `in_flight`,
  `abandoned`, `typical_ratio`, `min_finished_runs` (3). "Finished" means every event is at
  100%; "abandoned" means unfinished with the last date more than 60 days past. The API
  contract is that fields are only ever added.
- **The app has no notion of money or effort** anywhere: no currency setting, no cost field, no
  locale handling beyond dates.
- **Template comments exist** (`TemplateComment`), visible to everyone who can see the template.
- **The original project is not a run.** A template saved from a project does not remember that
  project, so the run that *produced* the plan, usually the best-documented one, counts for nothing.
- **No template versions yet** (library phase 2), so a run cannot say which version it used.
- UI homes: the project toolbar and gear menu (`Toolbar.jsx`), the project page
  (`ProjectTimeline.jsx`), the project editor (`CreateProjectModal.jsx`, which already holds the
  track-record opt-out), and the template page's Track record section (`TemplatePage.jsx`).

## 2. Prior art / research

*From working knowledge, not fresh research.*

- **Project closure and "lessons learned"** (PMBOK, PRINCE2): every method has a closing step
  that records actual cost, outcome and lessons. In practice it is a long form filled in late by
  someone who has moved on, filed where nobody reads it. The lesson: **short, at the moment of
  finishing, and wired to where the next run starts.** A template is exactly that place.
- **Retrospectives** (agile): "what went well, what to change". Good at the conversation, poor at
  carrying the result forward. Here the carrier is the template.
- **Reference class forecasting** (Flyvbjerg; used for public infrastructure): estimate a new
  project from the *actual* outcomes of similar past projects instead of from the plan's
  optimism. That is what these totals are: "plans like this typically run 7% long and cost about
  $14,000" is a reference class of one template. Few tools offer it because few know which
  projects were the same kind; provenance gives that for free.
- **Ratings elsewhere:** five-star scales cluster at 4 to 5 and mean little. A plain
  did-it-work question with few answers produces a number people can act on.
- **Salary and pricing surveys:** the standard protections for sensitive numbers are a minimum
  sample size, medians not means, no minimum/maximum, and rounding. Adopted below.

## 3. Proposed design

### 3.1 The three questions

Asked of a project owner, all optional, editable afterwards:

1. **How did it go?** One of:
   - *It worked* (we would run this plan again as it is)
   - *It worked, with changes* (we got there, but had to bend the plan)
   - *It did not work* (the plan was wrong for this)
   - *We stopped early* (cancelled or abandoned, whatever the reason)
2. **What did it cost?** Either or both of:
   - **Money:** an amount and a currency (defaulting to the server's `DEFAULT_CURRENCY`).
   - **Effort:** person-days. For internal work the real cost is people's time and nobody knows
     the money figure; for a hobby build it is the other way round.
3. **What would you change next time?** One or two sentences (500 characters). Goes to the
   template's owner. A tick box, off by default, also posts it as a comment on the template,
   under your name, so other people running the plan can read it.

Closing out also marks the run **closed**: it stops counting as "in flight" or "stalled" even if
some events never reached 100%, which answers R6 and makes the track record more truthful.

### 3.2 When it is offered

- **When the last event reaches 100%** in a project that came from a template, a quiet banner
  appears on the project page for owners: "This project is finished. Close it out: what it cost
  and how the plan worked. It takes a minute and helps the next run." Buttons: **Close it out**
  and **Not now**. "Not now" is remembered on the server, per project, and the banner never
  returns on its own.
- **Any time**, from the gear menu: **Close out…** (owners only). This is how a run that stopped
  early gets recorded, and how a close-out is edited later.
- **Projects that did not come from a template** can be closed out too. The answers are kept on
  the project, and if the project is later saved as a template they become its first data point
  (3.5).
- Never a modal on load, never an email, never a second reminder.

### 3.3 Data model

- **`RunCloseout`** (one per project): `project` (one-to-one), `outcome` (choice, nullable),
  `cost_amount` (decimal, nullable), `cost_currency` (ISO 4217 code), `effort_person_days`
  (decimal, nullable), `lesson` (text), `share_figures` (bool, default true: "include my numbers
  in the template's totals"), `closed_by`, `closed_at`, `updated_at`.
- **`Project.closeout_dismissed`** (bool) for "Not now".
- **`ProjectTemplate.origin_project`** (nullable FK, set when a template is saved from a project)
  for 3.5.
- Setting **`DEFAULT_CURRENCY`** (default `USD`). A short fixed list of currencies in the picker,
  with "other" accepting any three-letter code. No conversion, ever.
- When library phase 2 adds template versions, the project's `source_template_version` lets
  totals be shown per version. Nothing here blocks that.
- Migrations are additive.

### 3.4 What a template shows

The track record gains two blocks (API fields are added, none change):

- **Outcome:** "Worked in 9 of 11 closed-out runs", with the four counts available on the
  template page. Shown once **three** runs have been closed out.
- **Cost:** "Typically costs about $14,000" and/or "about 45 person-days", from the runs that
  gave a figure and left `share_figures` on. Rules, all from the survey playbook:
  - the **median**, never the mean, and **never a minimum, maximum or range**;
  - at least **three** figures in the *same currency* before anything is shown; with mixed
    currencies only the most common one is shown, labelled with its count;
  - **rounded to two significant figures**, which also blunts working out one run's number by
    watching the median move as runs are added;
  - "from 6 runs" is always stated, so nobody mistakes three data points for a law.
- Library cards get at most one extra phrase ("worked 9 of 11"); cost stays on the template page.
- A project with `count_in_track_record` off contributes nothing, as today.
- The **lesson** is never aggregated or shown anywhere except to the template's owner (a
  "Lessons from runs" list on their template page: text and date, no project name unless it is
  their own project) and, if the closer ticked the box, as an ordinary comment.

### 3.5 The original run counts

When a template is saved from a project, remember that project (`origin_project`). Its dates
give the template its first finished run, and its close-out, if any, its first cost and outcome.
"Save as Template" on a finished project therefore offers the close-out questions inline. A
template then starts life with one real data point instead of none, which matters most for
exactly the templates worth sharing: the ones made from a project that went well.

### 3.6 API

- `GET | PUT | DELETE /api/projects/<id>/closeout/` — read: any member; write: owners.
- `POST /api/projects/<id>/closeout/dismiss/` — owners.
- `ProjectSerializer` gains `closeout_state` (`none` | `offered` | `dismissed` | `closed`) so the
  page knows whether to show the banner. `offered` is computed: from a template or not, all
  events at 100%, not dismissed, not closed.
- `track_record` gains `closed`, `outcomes` `{worked, worked_with_changes, did_not_work,
  stopped}`, and `cost` `{median, currency, runs, effort_median_days, effort_runs}`, each null
  until its minimum is met.
- `GET /api/templates/<key>/lessons/` — the template's owner only.

### 3.7 UI / UX

- **The banner** (3.2) and a **Close out** dialog: three short sections matching 3.1, a line
  under the cost fields saying exactly where the number goes ("Used only in this template's
  totals, never shown with your project's name. Untick to keep it private to this project."),
  and the opt-out tick box. Works on a phone; nothing depends on hover.
- **A closed project** shows a small "Closed out" marker beside its name and, in the project
  editor, the answers with an Edit button. Editing a plan after closing is still allowed.
- **The template page:** the Track record section grows an outcome line and a cost line, with the
  same "appears after three" placeholder text used for the time ratio today.
- **Wording** (R5): "how the plan worked", never "how the team did"; "we stopped early", never
  "failed".

### 3.8 Permissions impact

- Closing out, editing and dismissing: project **owners** (decided on the server from
  `get_role`, as everywhere). Members can read their own project's close-out.
- A template's totals are visible to whoever can see the template. Its lessons list is visible to
  its owner only. No close-out is ever reachable through a template by anyone else.
- Staff get no extra view of other people's cost figures in the app (the Django admin can see
  everything, as now).

## 4. Alternatives considered

- **A five-star rating.** Familiar, and nearly useless: it clusters high and nobody knows what 3
  means. Four plain answers give "worked in 9 of 11".
- **Cost in bands** ("under $1k, $1k to $10k, ..."). Less sensitive and no currency problem, but
  the bands would be wrong for half the templates (a sprint and a company formation differ by
  three orders of magnitude) and a median of bands is mush. Exact figures with strict display
  rules protect people better than vague inputs.
- **Track cost during the project** (budget per event, actuals as you go). A different, much
  larger product, and the usual reason project tools become unpleasant. One number at the end
  captures most of the value.
- **Compute cost from effort** (assignees times days times a rate). Needs rates, which are more
  sensitive than any project total, and the app has no notion of working time per person.
- **Ask every member, not just the owner.** Richer, and it turns into a survey tool. One answer
  per run keeps the numbers interpretable.
- **Show cost only to the template's owner.** Safest, and it throws away the point: the person
  choosing a plan is the one who needs to know what it typically costs. Kept as an open question.
- **A reminder email when a project finishes.** More close-outs, and the first piece of nagging
  in the product. No.

## 5. Phasing

- **Phase A — the close-out itself.** Model, API, banner, dialog, "closed" state, outcome and
  cost on the template page with all the display rules. *Satisfies R1 to R6.*
- **Phase B — the plan learns.** The original run counts (3.5), lessons to the template's owner,
  the post-as-comment option. *Satisfies R7 as far as phase 1 of the library allows.*
- **Phase C — with library phase 2.** Totals per template version; lessons offered as the draft
  of a new version's "what I learned" note; close-out figures travel in the exported file as
  totals, never as individual runs.
- **Later / maybe:** an expected cost on the template to compare against; the close-out as a
  final block on the status report; figures limited to recent years as prices drift.

### 5.1 What phase A built

As designed, with the proposals in section 7 taken as the answers: cost totals are visible to
everyone who can see the template; money and effort are both offered; the four outcome answers as
written; three figures minimum; owners only; the default currency is a server setting
(`DEFAULT_CURRENCY`). Notes:

- **Close out…** sits in the always-visible part of the gear menu on every screen size, because the
  toolbar has no button for it and "Not now" must never be a dead end.
- Members who are not owners can open a close-out read-only from the **Closed out** marker.
- "Finished" in the track record now means every event is at 100% **or** the run was closed out
  with any answer but "stopped"; "stopped" is its own count.
- The lesson is stored with the project and goes nowhere else yet. Reaching the template's owner,
  the post-as-comment option and the original run counting (3.5) are phase B.

### 5.2 What phase B built

- **The original run counts** (3.5): `ProjectTemplate.origin_project`, set when a template is saved
  from a project. It counts as started, as finished when done or closed out, and its close-out
  counts toward outcome and cost. It is **left out of the plan-versus-actual ratio**, a point the
  design above missed: its length is the plan's length, so it would always read "on plan" and drag
  the figure toward it. Saving a finished project as a template opens the close-out dialog with a
  line saying why. The origin is never exposed and never copied to a fork.
- **Lessons reach the owner:** `GET /api/templates/<key>/lessons/`, the template's owner only (not
  staff), text and date, the project named only if the owner is on it. The template page shows them
  under "Lessons from runs · only you see these".
- **Consent is per lesson.** Phase A's dialog said the lesson is "kept with this project", so the
  migration marks every earlier close-out as not sent. From now on the dialog has two tick boxes:
  send to the template's owner (on by default), and post as a comment (off by default, posted once,
  under the closer's name, only on a template they can still see).
- Built-in templates have no owner, so there a lesson can only stay with the project or be posted
  as a comment.

## 6. Cost & risk

- **Effort:** Phase A **M** (one model, one endpoint, a banner, a dialog, aggregate code and its
  tests). Phase B **S to M**. Phase C rides on library phase 2.
- **Migration / data risk:** additive. Existing projects simply have no close-out.
- **Privacy risk: the main one.** A cost figure can embarrass a team or leak a contract value.
  Mitigated by: every field optional; per-run `share_figures`; the existing track-record opt-out;
  a minimum of three same-currency figures; median only, no range; rounding; and lessons going
  only to the template's owner unless the closer chooses otherwise. These rules need adversarial
  tests of their own (including the "watch the median move" case), like
  `tests_template_library.py`.
- **Low response rates.** Most runs will not be closed out. That is acceptable, and the reason
  "from 6 runs" is always shown. The banner appearing at the moment of finishing, and taking a
  minute, is the whole strategy.
- **Misreading the numbers.** A median of three is weak evidence. The count is always beside it.
- **Currency and time.** No conversion and no inflation adjustment. Honest, and crude over many
  years; see Later.
- **Tone risk.** If this reads as grading people it will be resented and skipped. Wording is part
  of the design (R5) and should be reviewed as such.
- **Perf:** one more grouped query next to the existing track-record query. No timeline impact.

## 7. Open questions / decisions needed

- [x] **Who may see a template's cost totals:** everyone who can see the template (proposed), or
      only its owner, or the owner's choice per template?
- [x] **Money, effort, or both?** Proposed both, each optional.
- [x] **The four outcome answers:** are these the right words?
- [x] **Minimum before showing:** three, as for time (proposed), or five for cost?
- [x] **Should the original project count as the template's first run** (3.5)? Proposed yes.
- [x] **Should non-owners who are editors be able to close out?** Proposed no: owners only.
- [x] **Default currency:** a server setting (proposed), or per user?
