# Touch Timeline — Design Document

**Status:** Building — Phases 1 and 2 shipped 2026-09-19 (navigate and edit by touch). Phase 3 (header rail, landscape toolbar, timeline as the phone default) not started.
**Last updated:** 2026-09-19
**Scope:** Make the timeline view itself fully usable by touch (phones and tablets): pan, pinch-zoom, move, resize, select, and the minimap.

---

## 0. Problem / motivating requirements

Timeline was designed first and foremost around direct, visual interaction with the
timeline. On a phone that interaction does not exist. The list and board views work by
touch, but the view the app is named after does not, so a phone user is pushed toward
the list, which is the opposite of the product's intent.

Requirements:

- **R1. Pan** the timeline with one finger, with momentum, in both axes.
- **R2. Zoom** with a two-finger pinch, anchored at the pinch midpoint, from months down
  to minutes, using the same smooth zoom the mouse gets.
- **R3. Move** an event by touch, in time and across tracks, without a keyboard modifier.
- **R4. Resize** an event by touch from either end.
- **R5. Open** an event with a tap (already works).
- **R6. Navigate** with the minimap by touch: tap to jump, drag the viewport box.
- **R7. Never move an event by accident.** This is the reason events are "sticky" on
  desktop (plain drag pans, Ctrl/⌘-drag moves) and it matters more on a phone, where
  every pan starts with a finger on top of some event.
- **R8. One code path.** Mouse, trackpad, pen, and touch should share handlers so the
  desktop behavior cannot drift from the touch behavior.
- **R9. Timeline is the default view on phones** once R1 to R6 hold. Today phones
  default to the list (`ProjectTimeline.jsx`, `innerWidth <= 720`).

Already satisfied: tap to open (R5), one-finger pan via native scrolling of
`.timeline-scroll` (partly R1), and the phone layout pass of 2026-09-19 (compact
two-row toolbar, docked dashboard, `100dvh`, safe-area insets, 44px targets).

## 1. Current state (grounding)

All timeline interaction is wired to **mouse events**. There is not a single touch or
pointer handler in the three files that matter:

| File | Mouse handlers | What they do |
|---|---|---|
| `frontend/src/components/Timeline.jsx` | 15 | drag-to-pan on the scroll container (`mousedown` + document `mousemove`/`mouseup`), Shift-drag marquee select, wheel zoom (`ctrlKey`/`metaKey`, which is also how a trackpad pinch arrives), keyboard zoom/pan, the "armed" cursor while Ctrl/⌘ is held |
| `frontend/src/components/EventBlock.jsx` | 16 | `handleMoveDown`: Shift-click toggles selection; **without Ctrl/⌘ a drag is ignored** (it bubbles to the pan handler) and a clean click opens the editor; with Ctrl/⌘ it moves the event (time + track), with edge auto-pan, snap, group move; `handleResizeDown` on the two `.resize-handle` strips, also gated on Ctrl/⌘ |
| `frontend/src/components/Minimap.jsx` | 4 | click to jump, drag the viewport box |

Consequences on iOS Safari and Android Chrome:

- Browsers synthesize mouse events only for a **tap**, never for a drag. So R3, R4, R6
  (drag), and marquee select are unreachable. The Ctrl/⌘ gate makes R3/R4 unreachable
  even in principle.
- Pinch does not produce `wheel` events on iOS. Safari fires proprietary
  `gesturestart/gesturechange`; every browser delivers two active pointers. So R2 does
  nothing; the page-level pinch is also disabled because the body is `overflow: hidden`.
- One-finger pan works only because `.timeline-scroll` is `overflow: auto` and the
  browser scrolls it natively. That is good: native scrolling has momentum and runs
  off the main thread. The design below keeps it.
- Zoom state lives in `Timeline.jsx` (`pxPerHour`, a rAF easing loop, `zoomByFactor`
  anchored at a client X). A pinch can call the same function.
- The resize handles are 8px strips, fine for a mouse, far too small for a finger.
- The track-header column is 112px on phones (29% of a 390px screen) and truncates
  names to four letters.
- `MovablePanel.jsx` already uses pointer events with `window` listeners, so the
  pattern exists in the codebase.

## 2. Prior art / research

How touch-first tools resolve "pan versus move" when every pan starts on an object:

- **Long-press to pick up** is the platform convention: iOS home screen, Reminders,
  Calendar (long-press an event, it lifts, then drag), Trello and Linear mobile boards,
  Google Calendar mobile. Roughly 350 to 500 ms, with a lift animation and a haptic tick.
- **Calendar apps resize with visible grab dots** on the lifted event rather than
  invisible edge strips. Fantastical and Google Calendar both show two handles only
  while an event is selected.
- **Gantt tools on phones mostly give up.** TeamGantt, GanttPRO, and MS Project's web
  view fall back to lists on phones. Instagantt and ClickUp render the chart but are
  read-only by touch. A Gantt that is genuinely editable by touch is a differentiator,
  not table stakes.
- **Pinch zoom on a custom canvas** is solved the same way everywhere: track two
  pointers, scale by the ratio of their distance to the starting distance, anchor at
  their midpoint, and set `touch-action` so the browser does not also zoom the page.
- **`@dnd-kit`**, already used for the board, implements exactly this long-press
  activation for its touch sensor (`activationConstraint: { delay, tolerance }`), so the
  board and the timeline will feel consistent.

The finding that shapes the design: long-press is the touch equivalent of the Ctrl/⌘
modifier. It preserves R7 with no new UI, and users already know it.

## 3. Proposed design

No data model, API, or permissions changes. This is frontend only.

### 3.1 Pointer events everywhere (R8)

Replace `mousedown/mousemove/mouseup` with `pointerdown/pointermove/pointerup/
pointercancel` in `Timeline.jsx`, `EventBlock.jsx`, and `Minimap.jsx`, using
`setPointerCapture` instead of document-level listeners. Branch on `e.pointerType`
only where behavior truly differs:

| Gesture | mouse / pen | touch |
|---|---|---|
| Pan | drag empty space or an event (as today) | native one-finger scroll (as today) |
| Zoom | Ctrl/⌘ + wheel, trackpad pinch, buttons, keys | two-finger pinch, buttons |
| Move event | Ctrl/⌘ + drag | **long-press (400 ms), then drag** |
| Resize event | Ctrl/⌘ + drag an edge | tap-select or long-press, then drag a **grab dot** |
| Open event | click | tap |
| Multi-select | Shift-click, Shift-drag marquee | long-press an event, then tap others ("select mode") |
| Minimap | click, drag box | tap, drag box |

### 3.2 `touch-action`

- `.timeline-scroll { touch-action: pan-x pan-y; }` lets the browser keep native
  one-finger scrolling and momentum, and stops it from claiming a pinch for page zoom,
  so the two-pointer pinch reaches our handler.
- `.minimap`, grab dots, and a **lifted** event get `touch-action: none` so their drags
  are ours from the first pixel.

### 3.3 Pinch zoom (R2)

In `Timeline.jsx`, keep a `Map<pointerId, {x, y}>` of active touch pointers on the
scroll container. When it holds two:

1. Record the starting distance, midpoint X, and `pxPerHour`.
2. On each move, `target = startPxPerHour * (distance / startDistance)`, clamped to
   `MIN_PX_PER_HR`/`MAX_PX_PER_HR`, applied through the existing anchored zoom with the
   midpoint as the anchor. Apply it **directly, without the easing loop**: a pinch must
   track the fingers one to one; easing is for discrete steps.
3. When a pointer lifts, end the pinch. If one finger remains, native scrolling resumes.

Safari's `gesturechange` is not needed; two pointers are delivered on iOS 13+.

### 3.4 Long-press to move (R3, R7)

In `EventBlock.jsx`, for `pointerType === 'touch'`:

1. On `pointerdown`, start a 400 ms timer and remember the point.
2. If the pointer moves more than 8px before the timer fires, cancel: it was a pan.
3. If it lifts before the timer fires with little movement, it was a tap: open the editor.
4. If the timer fires: **lift** the event. Add a `lifted` class (scale 1.03, stronger
   shadow, `touch-action: none`), call `navigator.vibrate?.(10)`, capture the pointer,
   and suppress the scroll container's native pan for the rest of the gesture (set
   `overflow: hidden` on it while lifted, restore on release).
5. While lifted, drag moves the event with the **existing** move math: time from X,
   track from Y, snap, edge auto-pan, group move.
6. Release commits through the existing `onUpdate`; `pointercancel` reverts.

Undo already exists and is one tap away in the toolbar, which softens any mistake.

### 3.5 Grab dots to resize (R4)

A lifted or tap-selected event shows two round handles, 28px visible inside a 44px hit
area, centered on its left and right edges and extending outside the block. Dragging
one runs the existing resize math. The 8px edge strips stay for mouse and pen.

On touch a first tap selects (shows the dots and a small floating bar: Edit, Tasks,
Delete) and a second tap, or the Edit button, opens the editor. This replaces the
hover action buttons that were hidden on touch in the 2026-09-19 layout pass.

### 3.6 Minimap (R6)

Pointer events with capture and `touch-action: none`. Raise it from 46px to 56px on
phones so the viewport box is grabbable, and give the box a minimum width of 44px.

### 3.7 Room for the canvas

- Track headers on phones collapse to a **32px rail**: the color bar plus the event
  count. Tapping the rail slides the full 112px headers over the canvas; tapping away
  hides them. This gives the canvas 92% of the width instead of 71%.
- Landscape: hide toolbar row 2 behind the gear when the viewport is under 480px tall.
- The first time someone opens the timeline on a touch device, show a three-line coach
  mark: drag to pan, pinch to zoom, press and hold an event to move it. This mirrors
  the desktop Ctrl/⌘ hint.

### 3.8 Default view (R9)

Once phases 1 and 2 ship, remove the `innerWidth <= 720 → 'list'` default so phones
open on the timeline like every other device. A saved preference still wins.

## 4. Alternatives considered

- **A separate phone timeline** (vertical "agenda with bars", time running down the
  screen). It fits a portrait screen better, but it is a second view to build and keep
  in step, and it is not the product's signature interaction. Rejected as the primary
  answer; it could come back later as a fourth view.
- **An "edit mode" toggle** in the toolbar that swaps pan for move. It is discoverable,
  but modal, it costs a tap each way, and people forget which mode they are in, which
  is the accidental-move problem again. Rejected.
- **Move on plain drag, pan with two fingers** (the maps convention inverted). One
  finger panning is too deeply learned, and it would make accidental moves constant.
  Rejected; it fails R7.
- **Bridge touch to mouse events** (synthesize `mousedown` from `touchstart`). Quick,
  but it keeps the Ctrl/⌘ gate, fights native scrolling, and leaves two code paths.
  Rejected in favor of pointer events.
- **A gesture library** (Hammer.js, `@use-gesture/react`). `@use-gesture` is good and
  small, but the needs here are two gestures and the existing handlers already own the
  math. Pointer events are about the same amount of code with no dependency. Revisit
  only if pinch proves fiddly across browsers.

## 5. Phasing

- **Phase 1 — pointer events + pinch (R1, R2, R6, R8). SHIPPED.** As built: pinch uses *touch*
  events (not pointer events), because `preventDefault()` on a two-touch `touchmove` is the
  only reliable way to stop the browser claiming the gesture; the midpoint also pans. The
  resize strips no longer swallow taps on touch (they covered most of a narrow event). Original scope: Mechanical conversion of the
  three files, `touch-action`, pinch zoom, touch minimap. No behavior change for mouse
  users. After this the timeline is fully *navigable* on a phone.
- **Phase 2 — long-press move + grab-dot resize (R3, R4, R7). SHIPPED.** As built: open
  question 1 was settled as "a tap opens the editor, as on desktop"; the grab dots appear
  after a long-press (with or without a drag), so there is no tap-to-select step and no
  floating action bar. Native scrolling is held off during a lifted drag by a non-passive
  `touchmove` listener rather than by toggling `overflow`. Original scope: The lifted state, grab
  dots, tap-to-select bar, coach mark. After this the timeline is fully *editable*.
- **Phase 3 — canvas room + default view (R9).** The 32px header rail, landscape
  toolbar, timeline as the phone default.
- **Later / maybe:** touch multi-select mode, a vertical agenda-with-bars view, haptics
  on snap, iPad split-view polish.

## 6. Cost & risk

- **Effort:** Phase 1 M, Phase 2 M, Phase 3 S. No backend work, no migrations.
- **Risk — desktop regressions.** The mouse path is the product; the conversion touches
  every handler in it. Mitigation: phase 1 changes event *types* only, and the existing
  Playwright checks (plain drag shows the hint, Ctrl/⌘-drag moves, undo restores) run
  before and after. Add touch checks using Playwright's touchscreen and CDP pinch.
- **Risk — iOS Safari specifics.** `touch-action` support is partial before iOS 13;
  `setPointerCapture` plus native scrolling has had bugs; long-press triggers the
  system text-selection callout unless `-webkit-touch-callout: none` and
  `user-select: none` are set on event blocks (the body already has the latter).
  Mitigation: test on a real iPhone at the end of each phase, not only in emulation.
- **Risk — long-press feels slow.** 400 ms is the convention; make it a constant so it
  can be tuned, and start the lift animation at 250 ms so the wait reads as feedback.
- **Risk — scope creep into a redesign.** Held off by R8: no new views, no new state
  model, the same move and resize math.

## 7. Open questions

1. Tap-to-select then tap-to-open (3.5) adds a tap before the editor on touch. Is that
   acceptable, or should a tap keep opening the editor directly and the grab dots only
   appear on long-press?
2. Should the header rail (3.7) also apply to tablets in portrait, or only to phones?
3. Is a vertical agenda-with-bars view worth a design doc of its own later?
