"""Facts and suggestions for a project status report.

``build_facts`` reads the live schedule and returns everything a status page can be filled in
from: dates, progress, milestones, the simplified timeline, blocked/overdue work, what finished
recently and what is due next. ``suggest`` turns those facts into a status, the rule that
produced it, and a drafted headline. Nothing here is persisted; ``StatusReport`` stores the
author's edited copy plus a frozen snapshot of these facts.

See docs/design/status-one-pager.md.
"""
from datetime import datetime, time, timedelta

from django.utils import timezone

from .models import Baseline, Category, Event, Task
from .schedule import critical_path

DAY_MS = 86_400_000

# Default status thresholds (docs/design/status-one-pager.md §3.2). Deliberately strict about the
# committed date; per-project overrides arrive with baselines.
DEFAULT_THRESHOLDS = {'off_track_working_days': 10, 'off_track_percent': 10, 'behind_points': 10}
HISTORY_LIMIT = 8
MOVED_LIMIT = 6


def thresholds_for(project):
    """The project's agreed limits over the defaults."""
    return {**DEFAULT_THRESHOLDS, **(project.status_thresholds or {})}


def _day(value):
    """Local calendar date of a datetime or an ISO string."""
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return timezone.localtime(value).date()


def history_from(reports):
    """Trend points from saved reports, oldest first: status, forecast finish, milestone dates."""
    points = []
    for r in list(reports)[:HISTORY_LIMIT][::-1]:
        snap = r.snapshot or {}
        if not snap.get('end'):
            continue
        points.append({'as_of': _iso(r.as_of), 'status': r.status, 'end': snap['end'],
                       'milestones': {str(m['id']): m['date'] for m in snap.get('milestones', []) if m.get('id') is not None}})
    return points

MAX_ROWS = 7
FACTS_VERSION = 1
LIST_LIMIT = 3


class _Ev:
    """Plain holder so the schedule math does not touch the ORM per event."""
    __slots__ = ('id', 'title', 'start', 'end', 'category', 'percent', 'is_milestone', 'dep_ids')

    def __init__(self, e, dep_ids):
        self.id, self.title, self.start, self.end = e.id, e.title, e.start, e.end
        self.category, self.percent, self.is_milestone = e.category, e.percent_complete, e.is_milestone
        self.dep_ids = dep_ids


def _iso(dt):
    return dt.isoformat() if dt else None


def working_days_between(start_date, end_date):
    """Signed count of Mon-Fri days from start_date (exclusive) to end_date (inclusive)."""
    if start_date == end_date:
        return 0
    sign = 1 if end_date > start_date else -1
    a, b = (start_date, end_date) if sign == 1 else (end_date, start_date)
    n, d = 0, a
    while d < b:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return sign * n


def _weighted_progress(evs):
    total = sum((e.end - e.start).total_seconds() for e in evs)
    if total <= 0:
        return 0
    done = sum((e.end - e.start).total_seconds() * (e.percent / 100) for e in evs)
    return round(100 * done / total)


def build_facts(project, now=None, since=None, previous_snapshot=None, history=None):
    """``previous_snapshot`` (the last saved report's facts) drives "what moved since last report";
    ``history`` (from ``history_from``) is passed through for the milestone trend chart."""
    now = now or timezone.now()
    since = since or (now - timedelta(days=14))

    rows = list(Event.objects.filter(project=project).prefetch_related('depends_on'))
    evs = [_Ev(e, [d.id for d in e.depends_on.all()]) for e in rows]
    colors = dict(Category.objects.filter(project=project).values_list('name', 'color'))

    facts = {
        # Bump when a field changes meaning or is removed. Adding fields does not need a bump:
        # consumers (the print tool, exports, scripts) must ignore what they do not know.
        'version': FACTS_VERSION,
        'as_of': _iso(now),
        'since': _iso(since),
        'project': {'id': project.id, 'name': project.name,
                    'committed_end': project.committed_end.isoformat() if project.committed_end else None,
                    'commitment_source': 'project' if project.committed_end else None},
        'thresholds': thresholds_for(project),
        'baseline': None, 'since_last': None, 'history': history or [],
        'empty': not evs,
    }
    if not evs:
        facts.update({'start': None, 'end': None, 'progress': 0, 'elapsed': 0, 'variance_days': None,
                      'variance_working_days': None, 'milestones': [], 'rows': [], 'critical_ids': [],
                      'blocked_tasks': 0, 'overdue_tasks': 0, 'critical_blocked_or_overdue': 0,
                      'completed_recently': [], 'due_next': [], 'event_count': 0})
        return facts

    start = min(e.start for e in evs)
    end = max(e.end for e in evs)
    span = (end - start).total_seconds() or 1
    elapsed = max(0, min(100, round(100 * (now - start).total_seconds() / span)))
    progress = _weighted_progress(evs)

    cpm = critical_path(evs)
    critical = cpm['critical_ids']

    # Forecast finish is the schedule's current end: the plan as it stands today. Variance is
    # measured against the project's committed date when one is set.
    # The commitment is the project's committed date; without one, the active baseline's finish.
    baseline = Baseline.objects.filter(project=project, active=True).first()
    base_ev = (baseline.events or {}) if baseline else {}
    committed = project.committed_end
    if committed is None and baseline is not None:
        committed = baseline.committed_end or (_day(baseline.planned_end) if baseline.planned_end else None)
        if committed:
            facts['project'].update({'committed_end': committed.isoformat(), 'commitment_source': 'baseline'})
    variance_days = variance_wd = None
    if committed:
        local_end = timezone.localtime(end).date()
        variance_days = (local_end - committed).days
        variance_wd = working_days_between(committed, local_end)

    today = timezone.localdate(now)
    tasks = list(Task.objects.filter(event__project=project).exclude(status=Task.Status.DONE)
                 .values('event_id', 'status', 'due_date'))
    blocked = [t for t in tasks if t['status'] == Task.Status.BLOCKED]
    overdue = [t for t in tasks if t['due_date'] and t['due_date'] < today]
    crit_trouble = len({id(t) for t in blocked + overdue if t['event_id'] in critical})

    def ev_dict(e):
        b = base_ev.get(str(e.id))
        return {'id': e.id, 'title': e.title, 'start': _iso(e.start), 'end': _iso(e.end),
                'category': e.category, 'percent_complete': e.percent,
                'critical': e.id in critical, 'is_milestone': e.is_milestone,
                # Against the active baseline; None when there is none or the event is newer than it.
                'baseline_start': b['start'] if b else None, 'baseline_end': b['end'] if b else None,
                'slip_days': (_day(e.end) - _day(b['end'])).days if b else None}

    milestones = []
    for e in sorted((e for e in evs if e.is_milestone), key=lambda e: e.end):
        state = 'done' if e.percent >= 100 else ('late' if e.end < now else 'upcoming')
        milestones.append({**ev_dict(e), 'date': _iso(e.end), 'state': state})

    # One row per track, ordered by when the track starts, capped so the page stays readable.
    by_cat = {}
    for e in evs:
        by_cat.setdefault(e.category, []).append(e)
    cats = sorted(by_cat, key=lambda c: min(e.start for e in by_cat[c]))
    if len(cats) > MAX_ROWS:
        keep, rest = cats[:MAX_ROWS - 1], cats[MAX_ROWS - 1:]
        by_cat['Other'] = [e for c in rest for e in by_cat.pop(c)]
        cats = keep + ['Other']
    timeline_rows = []
    for c in cats:
        ce = by_cat[c]
        cb = [base_ev[str(e.id)] for e in ce if str(e.id) in base_ev]
        b_start = min((b['start'] for b in cb), key=datetime.fromisoformat, default=None)
        b_end = max((b['end'] for b in cb), key=datetime.fromisoformat, default=None)
        timeline_rows.append({
            'baseline_start': b_start, 'baseline_end': b_end,
            'slip_days': (_day(max(e.end for e in ce)) - _day(b_end)).days if b_end else None,
            'name': c, 'color': colors.get(c) or '#6B7A90',
            'start': _iso(min(e.start for e in ce)), 'end': _iso(max(e.end for e in ce)),
            'progress': _weighted_progress(ce), 'event_count': len(ce),
            'critical_spans': [[_iso(e.start), _iso(e.end)] for e in sorted(ce, key=lambda e: e.start) if e.id in critical],
        })

    completed = sorted((e for e in evs if e.percent >= 100 and since <= e.end <= now), key=lambda e: e.end, reverse=True)
    horizon = now + timedelta(days=21)
    due_next = sorted((e for e in evs if e.percent < 100 and now < e.end <= horizon), key=lambda e: (not e.is_milestone, e.end))

    if baseline is not None:
        ids = {str(e.id) for e in evs}
        facts['baseline'] = {
            'id': baseline.id, 'name': baseline.name, 'created_at': _iso(baseline.created_at),
            'committed_end': baseline.committed_end.isoformat() if baseline.committed_end else None,
            'planned_start': _iso(baseline.planned_start), 'planned_end': _iso(baseline.planned_end),
            'finish_slip_days': (_day(end) - _day(baseline.planned_end)).days if baseline.planned_end else None,
            'moved': sum(1 for e in evs if str(e.id) in base_ev and _day(e.end) != _day(base_ev[str(e.id)]['end'])),
            'added': sum(1 for e in evs if str(e.id) not in base_ev),
            'removed': sum(1 for k in base_ev if k not in ids),
        }

    if previous_snapshot and previous_snapshot.get('end'):
        was = {e['id']: e for e in previous_snapshot.get('events', [])}
        moved = []
        for e in evs:
            p = was.get(e.id)
            days = (_day(e.end) - _day(p['end'])).days if p else 0
            if days:
                moved.append({'id': e.id, 'title': e.title, 'is_milestone': e.is_milestone, 'critical': e.id in critical,
                              'from': p['end'], 'to': _iso(e.end), 'days': days})
        moved.sort(key=lambda m: (not m['is_milestone'], not m['critical'], -abs(m['days'])))
        facts['since_last'] = {
            'as_of': previous_snapshot.get('as_of'),
            'finish_days': (_day(end) - _day(previous_snapshot['end'])).days,
            'progress_points': progress - (previous_snapshot.get('progress') or 0),
            'moved': moved[:MOVED_LIMIT], 'moved_count': len(moved),
        }

    facts.update({
        'start': _iso(start), 'end': _iso(end), 'progress': progress, 'elapsed': elapsed,
        'variance_days': variance_days, 'variance_working_days': variance_wd,
        'length_days': round(span / 86400),
        'event_count': len(evs),
        'milestones': milestones,
        'milestones_done': sum(1 for m in milestones if m['state'] == 'done'),
        'milestones_late': sum(1 for m in milestones if m['state'] == 'late'),
        'rows': timeline_rows,
        'critical_ids': sorted(critical),
        'blocked_tasks': len(blocked), 'overdue_tasks': len(overdue),
        'critical_blocked_or_overdue': crit_trouble,
        'completed_recently': [ev_dict(e) for e in completed[:LIST_LIMIT * 2]],
        'due_next': [ev_dict(e) for e in sorted(due_next[:LIST_LIMIT * 2], key=lambda e: e.end)],
        'events': [ev_dict(e) for e in sorted(evs, key=lambda e: e.start)],
    })
    return facts


def _fmt(d):
    return f'{d.strftime("%b")} {d.day}'


def suggest(facts):
    """Return ``{'status', 'rule_fired', 'headline'}`` from the facts. First matching rule wins."""
    if facts['empty']:
        return {'status': 'on_track', 'rule_fired': 'no events yet', 'headline': f"{facts['project']['name']}: no schedule yet."}

    wd, days = facts['variance_working_days'], facts['variance_days']
    limits = {**DEFAULT_THRESHOLDS, **(facts.get('thresholds') or {})}
    # What the forecast is measured against: a committed date, or failing that the baseline's finish.
    noun = 'baseline' if facts['project'].get('commitment_source') == 'baseline' else 'commitment'
    length = facts.get('length_days') or 1
    behind = facts['elapsed'] - facts['progress']
    late_ms = facts['milestones_late']
    end = timezone.localtime(datetime.fromisoformat(facts['end'])).date()
    committed = facts['project']['committed_end']

    status, rule = 'on_track', 'no rule fired'
    if wd is not None and (wd > limits['off_track_working_days'] or days > limits['off_track_percent'] / 100 * length):
        status, rule = 'off_track', f'forecast finish {days} days past {noun}'
    elif late_ms:
        status, rule = 'off_track', f'{late_ms} key milestone{"s" if late_ms != 1 else ""} past due and not complete'
    elif days is not None and days > 0:
        status, rule = 'at_risk', f'forecast finish {days} day{"s" if days != 1 else ""} past {noun}'
    elif facts['critical_blocked_or_overdue']:
        n = facts['critical_blocked_or_overdue']
        status, rule = 'at_risk', f'{n} blocked or overdue task{"s" if n != 1 else ""} on the critical path'
    elif behind >= limits['behind_points']:
        status, rule = 'at_risk', f'work complete is {behind} points behind time elapsed'

    # The project's name is already in the page's identity bar, so the headline does not repeat it.
    if committed is None:
        lead = f'Planned to finish {_fmt(end)}'
        tail = {'on_track': ', with work keeping pace with the schedule.',
                'at_risk': f'; at risk: {rule}.', 'off_track': f'; off track: {rule}.'}[status]
        headline = lead + tail
    else:
        c = datetime.combine(datetime.fromisoformat(committed).date() if 'T' in committed else datetime.strptime(committed, '%Y-%m-%d').date(), time())
        if days > 0:
            headline = f'Forecast to finish {_fmt(end)}, {days} day{"s" if days != 1 else ""} past the {_fmt(c)} {noun}.'
        elif days < 0:
            headline = f'Forecast to finish {_fmt(end)}, {-days} day{"s" if days != -1 else ""} ahead of the {_fmt(c)} {noun}.'
        else:
            headline = f'On course for the {_fmt(c)} {noun}.'
        # The headline must never contradict the status chip: a date that still holds can be
        # at risk for another reason (blocked critical work, work well behind time, a missed milestone).
        if status != 'on_track' and days <= 0:
            word = 'at risk' if status == 'at_risk' else 'off track'
            headline = f'The {_fmt(c)} {noun} still holds on paper, but it is {word}: {rule}.'
    return {'status': status, 'rule_fired': rule, 'headline': headline}
