# Closing out a run: what it cost and how well it worked — Design Document

**Status:** Phases A and B built (2026-09-20); phase C waits for library phase 2; the addendum in section 8 (Lessons learned) is designed and waits for a go-ahead to build
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
- **Phases D1 and D2 — the runs that did not work** are designed in section 8 and do not depend
  on library phase 2.

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

---

## 8. Addendum: what the runs that did not work have to teach

**Status:** Design settled (2026-09-20): every question in 8.6 is answered. Not yet approved to build; nothing here is built.

### 8.0 Problem

A template says "worked in 9 of 11 closed-out runs". The two that did not work are the most
useful thing the template knows (R6 says so), and the person choosing the plan cannot learn
anything from them. Four gaps, all found by reading the code as built:

- **The next person sees a count and no reason.** A lesson goes to the project and, by default,
  privately to the template's owner. It reaches anyone else only if the closer ticked "also post
  it as a comment", which is off by default, or if the owner quietly changed the plan.
- **The lesson waits on someone who did not learn it.** The person who ran the project writes it;
  the template's owner has to notice it and act. An owner who never looks is where lessons stop.
- **Every outcome gets the same question.** `CloseoutModal.jsx` asks "What would you change next
  time?" whether the answer above it was "It worked" or "It did not work". That is the right
  question for a run that worked and a weak one for a run that did not.
- **Nothing connects a lesson to the plan.** Phase C turns lessons into the draft of a version's
  "what I learned" note, and phase C waits on library phase 2, which is on hold.

One more requirement:

- **R8. The next person learns from the runs that did not work.** What went wrong, and when not to
  use this plan, should be on the template's page before someone starts from it, in the words of
  the person who learned it. A run that did not work is knowledge, and sharing it is the point of
  the library.

Not in scope: a post-mortem form, root-cause categories, anything that names a run, and anything
that waits for template versions.

### 8.1 Design

**1. The question follows the answer.** The label above the lesson box changes with the outcome
chosen above it. Same field, same 500 characters:

| Outcome | The question |
|---|---|
| It worked | What would you change next time? |
| It worked, with changes | What did you have to change, and why? |
| It did not work | What went wrong? When would you not use this plan? |
| We stopped early | What stopped it? Was there an early sign the plan could have caught? |
| (none chosen) | What would you change next time? |

Text already typed stays when the outcome changes; only the label moves. The wording stays about
the plan (R5): "what went wrong", never "who" or "why did you".

**2. A typed lesson goes straight to the template.** Both of phase B's tick boxes ("Send this to
the template's owner", "Also post it as a comment") go away. Under the lesson box, one plain line
says where the words go, and one choice says how it is signed:

> This appears under **Lessons learned** on the template's page, with how the plan worked.
>
> Signed: **( • ) My name**  **(   ) Anonymous**

The name is the default: a lesson is a contribution, the writer gets the credit, and the next
person knows who to ask. **Anonymous** shows the entry as "Anonymous" to everyone, the template's
owner included. The choice can be changed later by reopening the close-out. The project's name is
not shown either way.

Details:

- The dialog runs the sharing review's check (`suspectIn` in `libraryModel.js`) on the lesson as it
  is typed and points out an email address, an @name, a phone number or a link, as it does for any
  text headed for a shared page.
- A project with **Count this project in its template's track record** unticked contributes
  nothing to the template, the lesson included, as today.
- A project that did not come from a template has no template to go to; the lesson stays with the
  project, and the line under the box says that instead.
- **Lessons saved before this ships** were typed under a dialog that said where they would go, so
  they stay there: with the project and, if sent, on the owner's private list. A lesson becomes
  public only when it is saved through the new dialog (`RunCloseout.lesson_public`).

**3. "Lessons learned" on the template page**, directly under the Track record, so the count and
the reasons sit together: "Worked in 9 of 11 closed-out runs", and under it what each run learned.

- Each entry shows the lesson, who wrote it (their username, as comments do, or "Anonymous"), how
  that run went ("It did not work"), and the month and year. No project name, no cost. Newest
  first.
- **The owner's notes come first.** The template's owner can add up to seven entries of their own
  (300 characters each), marked "From the plan's owner", for what no single run said: "Not a fit for
  a team under four people: the review steps assume someone independent."
- **The owner can take an entry down**, not rewrite it: the words are someone else's. If a lesson
  is wrong or out of date, the owner removes it and may write their own note instead. The
  writer still sees their lesson on their project, with a line saying it was taken down. Admins can
  take down any entry, which is how built-in templates, having no owner, are looked after. **Report**
  works on an entry as it does on a comment.
- Editing or clearing the lesson in the close-out changes or removes the entry. Deleting the
  close-out or the project removes it. Turning off the track-record tick removes it.
- **It is shown once more, at the moment it matters:** when someone starts a project from the
  template (`TemplateModal.jsx`), under the start date: "Before you start: what earlier runs
  learned", the owner's notes and the five newest, with a link to the rest. Read-only, nothing to
  acknowledge, nothing blocked.
- **Copies.** A copy is a new template with its own runs, as for the track record. The owner's
  notes are copied; run lessons stay with the original, which the copy already links to.
- **Built-in templates get lessons too**, from the first run that types one.

**4. The owner's private list winds down.** "Lessons from runs · only you see these" keeps showing
the lessons that were sent to it before this ships, and gets nothing new. When it is empty it is
not shown.

### 8.2 Data model and API

- `RunCloseout.lesson_anonymous` (bool, default false). The name shown is `closed_by`'s.
- `RunCloseout.lesson_public` (bool, default false; set when a lesson is saved through the new
  dialog) and `RunCloseout.lesson_removed_at` / `lesson_removed_by` (taken down by the template's
  owner or an admin). `lesson_to_owner` and `posted_comment` stay for the lessons that used them.
- **`TemplateOwnerNote`**: `template_key` (as `TemplateComment`), `text` (300), `position`,
  `created_by`, `created_at`, `updated_at`.
- Lessons learned is **computed, not copied**: the close-outs of the template's runs (the same set
  `lessons_for` uses) with a lesson, `lesson_public`, not removed, in the track record. One source
  of truth, so an edited or deleted lesson can never linger on a template.
- `GET /api/templates/<key>/` gains `lessons_learned: {notes: [{id, text}], runs: [{id, text,
  outcome, month, author}], total}`. `author` is null for an anonymous lesson, for every caller. `id` for a run's lesson is an opaque id that is not the project's or
  the close-out's. Fields are only added.
- `POST /api/templates/<key>/owner-notes/`, `PATCH | DELETE …/owner-notes/<id>/` — the template's
  owner. `POST …/lessons-learned/<id>/remove/` — the template's owner or an admin.
  `TemplateReport` gains an optional lesson reference.
- The close-out API stops accepting `lesson_to_owner` and `post_as_comment` for new saves (ignored,
  not an error, so an old client does not break).
- Migrations are additive.

### 8.3 Alternatives considered

- **Send lessons to the template's owner, who rewords and publishes them.** The first draft of this
  addendum. The lesson is written by the person who learned it and then waits on someone who did
  not. Most would never be published. Dropped.
- **Keep a tick box ("show this on the template").** A choice the writer has to reason about, for a
  question the line under the box already answers. Someone who typed a lesson, told where it goes,
  has agreed to it; someone who does not want it there does not type it.
- **Summarise lessons automatically.** The app has no language model and should not send close-out
  text anywhere.
- **Failure categories to tick** (scope, people, money, timing). Countable, and the counts would say
  nothing a planner can act on. "Book the venue first" is the useful unit.
- **Wait for phase C.** Version notes are the right long-term home for "what I learned", and they
  are on hold. This section does not depend on versions and folds into them later.

### 8.4 Phasing

D1 and D2 ship together as one release; they are listed apart because D1 has no new surface.

- **Phase D1 — ask better. (S)** The question follows the answer; the tick boxes go; the line and
  the name-or-anonymous choice under the box; the `suspectIn` check in the dialog.
- **Phase D2 — Lessons learned. (M)** The computed list on the template page, the owner's notes,
  taking an entry down, report, the list in the start-from-template dialog, built-ins, user guide
  and a README bullet. *Satisfies R8.*
- **Later / maybe:** pin a lesson or note to an event, so it appears in the new project at the step
  where it applies; lessons travel in the exported file with library phase 2; lessons per template
  version (phase C).

### 8.5 Cost and risk

- **Effort:** D1 **S**, D2 **M**. Additive migrations; existing close-outs and lessons are untouched.
- **Moderation.** Public text written by anyone who ran the plan. Covered by take-down, report, and
  the 500-character limit, as comments are.
- **Tests** as in `tests_closeout.py`: a lesson saved before the change is not published; no
  response carries a cost figure or a project or close-out id; an anonymous lesson carries no
  author for any caller, the template's owner and admins included; a removed, cleared or opted-out lesson
  disappears at once; only the owner or an admin can take one down.
- **Perf:** one more query on the template page, none on the library list. No timeline impact.

### 8.6 Open questions / decisions needed

- [x] **The section's name:** **Lessons learned** (decided 2026-09-20; "What to watch for" and
      "Known pitfalls" were the alternatives).
- [x] **The four questions in 8.1:** used as written (decided 2026-09-20), including "We stopped
      early", where the reason often has nothing to do with the plan.
- [x] **Where a typed lesson goes:** straight to the template's page, no tick boxes, no owner in
      between (decided 2026-09-20). This replaced the first draft's send-to-owner design.
- [x] **Built-in templates:** they get lessons like any other; admins take entries down (follows
      from the decision above).
- [x] **D1 alone first, or D1 and D2 together?** Together, as one release (decided 2026-09-20).
- [x] **Show the list in the start-from-template dialog:** yes, the owner's notes and the five
      newest, read-only (decided 2026-09-20).
- [x] **The owner can take a lesson down but not reword it,** and can add their own note instead
      (decided 2026-09-20).
