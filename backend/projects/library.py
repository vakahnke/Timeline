"""The template library: who may see a template, what they are shown, and how a plan has run.

Everything about access is decided here, on the server, from the caller's token and the database
(docs/PERMISSIONS.md, "Where authority comes from"). Design: docs/design/template-library.md.
"""
import copy
from collections import defaultdict
from datetime import timedelta
from math import floor, log10
from statistics import median

from django.conf import settings
from django.db.models import Count, Max, Min, Q
from django.utils import timezone

from .models import (HiddenBuiltinTemplate, Project, ProjectTemplate, RunCloseout, Team,
                     TemplateComment, TemplateVote)
from .templates_builtin import BUILTIN_GROUPS, BUILTIN_TEMPLATES

# A track record shows how a plan ran only once this many runs have finished, so that one
# project's schedule can never be read off it.
MIN_FINISHED_RUNS = 3
# The same minimum applies to close-outs: that many runs must have answered before outcomes are
# shown, and that many figures in ONE currency before a cost is. Cost is more sensitive than dates,
# so it is also shown as a median only (never a lowest, highest or range) and rounded.
MIN_CLOSEOUTS = 3
# An unfinished run whose last date passed this long ago counts as abandoned, not in flight.
ABANDONED_AFTER = timedelta(days=60)

Visibility = ProjectTemplate.Visibility


def library_mode():
    return getattr(settings, 'TEMPLATE_LIBRARY', 'instance')


def allowed_visibilities():
    """How far this instance lets a template be shared."""
    return {
        'instance': [Visibility.PRIVATE, Visibility.TEAMS, Visibility.INSTANCE],
        'teams':    [Visibility.PRIVATE, Visibility.TEAMS],
    }.get(library_mode(), [Visibility.PRIVATE])


def my_team_ids(user):
    return list(Team.objects.filter(Q(owner=user) | Q(members=user)).values_list('id', flat=True).distinct())


def visible_templates(user):
    """THE visibility rule. Saved templates this user may see:

    * their own, always;
    * ones shared with a team they own or belong to (team membership is read live);
    * ones published to the whole instance;

    each only as far as the operator's TEMPLATE_LIBRARY setting allows. Staff can also see
    anything that has been published, so they can moderate it. Nobody but its owner sees a
    private template.
    """
    allowed = allowed_visibilities()
    q = Q(owner=user)
    if Visibility.TEAMS in allowed:
        if user.is_staff:
            q |= Q(visibility=Visibility.TEAMS)
        else:
            q |= Q(visibility=Visibility.TEAMS, shared_with_teams__in=my_team_ids(user))
    if Visibility.INSTANCE in allowed:
        q |= Q(visibility=Visibility.INSTANCE)
    return ProjectTemplate.objects.filter(q).distinct()


def hidden_builtin_slugs():
    return set(HiddenBuiltinTemplate.objects.values_list('slug', flat=True))


def normalise_key(raw):
    """Accept "saved:12", "builtin:sprint", and the older bare forms "12" and "sprint"."""
    raw = str(raw or '').strip()
    if raw.startswith(('saved:', 'builtin:')):
        return raw
    return f'saved:{raw}' if raw.isdigit() else f'builtin:{raw}'


class Resolved:
    """A template the caller is allowed to see, built-in or saved."""

    def __init__(self, key, *, builtin=None, saved=None, user=None):
        self.key, self.builtin, self.saved = key, builtin, saved
        self.is_mine = bool(saved and user and saved.owner_id == user.id)

    @property
    def name(self):
        return self.saved.name if self.saved else self.builtin['name']

    @property
    def description(self):
        return self.saved.description if self.saved else self.builtin['description']

    def spec(self):
        """The plan as THIS caller gets it. The owner gets all of it; everyone else gets it
        without the notes and/or to-dos if the owner chose not to share those."""
        if self.builtin:
            return {'categories': self.builtin['categories'], 'tasks': self.builtin['tasks']}
        tasks = copy.deepcopy(self.saved.tasks or [])
        if not self.is_mine:
            for t in tasks:
                if not self.saved.share_notes:
                    t['notes'] = ''
                if not self.saved.share_todos:
                    t['todos'] = []
        return {'categories': self.saved.categories or [], 'tasks': tasks}


def resolve(key, user):
    """The template behind ``key`` if this user may see it, else None. Callers answer None with
    a 404 whether the template is missing or merely not theirs to see."""
    key = normalise_key(key)
    kind, _, ident = key.partition(':')
    if kind == 'builtin':
        spec = BUILTIN_TEMPLATES.get(ident)
        if not spec or ident in hidden_builtin_slugs():
            return None
        return Resolved(key, builtin=spec, user=user)
    try:
        saved = visible_templates(user).select_related('owner').get(pk=int(ident))
    except (ProjectTemplate.DoesNotExist, ValueError):
        return None
    return Resolved(key, saved=saved, user=user)


def span_minutes(tasks):
    """How long the plan is, first start to last finish."""
    if not tasks:
        return 0
    first = min(int(t.get('start_offset_minutes', 0)) for t in tasks)
    last = max(int(t.get('start_offset_minutes', 0)) + max(1, int(t.get('duration_minutes', 60)))
               for t in tasks)
    return max(0, last - first)


# --- Track record ----------------------------------------------------------------------------

def _outcome_counts(closeouts):
    answered = [c['outcome'] for c in closeouts if c['outcome']]
    if len(answered) < MIN_CLOSEOUTS:
        return None
    return {choice: answered.count(choice) for choice in RunCloseout.Outcome.values}


def round_sig(value, figures=2):
    """Round to significant figures: 13,870 -> 14,000. Keeps a total readable, and blunts working
    out one run's figure by watching the median move as runs are added."""
    value = float(value)
    if value == 0:
        return 0.0
    return round(value, figures - 1 - floor(log10(abs(value))))


def _cost_totals(closeouts):
    """Median of the shared money figures in the most common currency, or None below the minimum."""
    by_currency = defaultdict(list)
    for c in closeouts:
        if c['share_figures'] and c['cost_amount'] is not None and c['cost_currency']:
            by_currency[c['cost_currency']].append(c['cost_amount'])
    if not by_currency:
        return None
    currency, amounts = max(by_currency.items(), key=lambda kv: (len(kv[1]), kv[0]))
    if len(amounts) < MIN_CLOSEOUTS:
        return None
    return {'median': round_sig(median(amounts)), 'currency': currency, 'runs': len(amounts)}


def _effort_totals(closeouts):
    days = [c['effort_person_days'] for c in closeouts
            if c['share_figures'] and c['effort_person_days'] is not None]
    if len(days) < MIN_CLOSEOUTS:
        return None
    return {'median_days': round_sig(median(days)), 'runs': len(days)}


def track_records(keys, now=None):
    """{key: record} for the given template keys, from the projects that were started from them.

    Aggregates only: it never says which projects, or whose. A project's owner can keep a run out
    of it (``Project.count_in_track_record``). ``typical_ratio`` (finished runs' actual length
    over the planned length, median) stays None until MIN_FINISHED_RUNS runs have finished.
    """
    now = now or timezone.now()
    runs = defaultdict(list)
    rows = (Project.objects
            .filter(source_template_key__in=list(keys), count_in_track_record=True)
            .annotate(n=Count('events'),
                      done=Count('events', filter=Q(events__percent_complete__gte=100)),
                      first=Min('events__start'), last=Max('events__end'))
            .values('id', 'source_template_key', 'source_template_span', 'n', 'done', 'first', 'last'))
    for r in rows:
        runs[r['source_template_key']].append(r)
    closeout_by_project = {
        c['project_id']: c for c in RunCloseout.objects
        .filter(project__source_template_key__in=list(keys), project__count_in_track_record=True)
        .values('project_id', 'outcome', 'cost_amount', 'cost_currency', 'effort_person_days', 'share_figures')}

    out = {}
    for key in keys:
        started = finished = abandoned = stopped = 0
        ratios, closeouts = [], []
        for r in runs.get(key, []):
            started += 1
            closeout = closeout_by_project.get(r['id'])
            if closeout:
                closeouts.append(closeout)
            # Closing out settles a run: "we stopped early" is its own count, and any other answer
            # means the owner calls it finished even if some events never reached 100%.
            if closeout and closeout['outcome'] == RunCloseout.Outcome.STOPPED:
                stopped += 1
            elif (r['n'] and r['done'] == r['n']) or closeout:
                finished += 1
                planned = r['source_template_span']
                if planned and r['first'] and r['last']:
                    ratios.append((r['last'] - r['first']).total_seconds() / 60 / planned)
            elif r['last'] is None or r['last'] < now - ABANDONED_AFTER:
                abandoned += 1
        enough = len(ratios) >= MIN_FINISHED_RUNS
        out[key] = {
            'started': started,
            'finished': finished,
            'in_flight': started - finished - abandoned - stopped,
            'abandoned': abandoned,
            'typical_ratio': round(median(ratios), 3) if enough else None,
            'min_finished_runs': MIN_FINISHED_RUNS,
            'stopped': stopped,
            'closed': len(closeouts),
            'outcomes': _outcome_counts(closeouts),
            'cost': _cost_totals(closeouts),
            'effort': _effort_totals(closeouts),
        }
    return out


# --- What the API returns ---------------------------------------------------------------------

def _counts(keys, user):
    votes = dict(TemplateVote.objects.filter(template_key__in=keys)
                 .values_list('template_key').annotate(n=Count('id')))
    mine = set(TemplateVote.objects.filter(template_key__in=keys, user=user)
               .values_list('template_key', flat=True))
    comments = dict(TemplateComment.objects.filter(template_key__in=keys)
                    .values_list('template_key').annotate(n=Count('id')))
    return votes, mine, comments


def _fork_names(keys, user):
    """Names of the templates things were copied from, but only ones this user may see."""
    names = {}
    for key in set(k for k in keys if k):
        found = resolve(key, user)
        if found:
            names[key] = found.name
    return names


def _shape(tasks, categories):
    return {
        'category_count': len(categories or []),
        'task_count': len(tasks or []),
        'milestone_count': sum(1 for t in tasks or [] if t.get('is_milestone')),
        'span_minutes': span_minutes(tasks or []),
    }


def describe(found_list, user):
    """List items for templates the caller has already been cleared to see."""
    keys = [f.key for f in found_list]
    votes, mine, comments = _counts(keys, user)
    records = track_records(keys)
    forks = _fork_names([f.saved.forked_from_key for f in found_list if f.saved], user)

    items = []
    for f in found_list:
        item = {
            'key': f.key,
            'name': f.name,
            'description': f.description,
            'votes': votes.get(f.key, 0),
            'voted': f.key in mine,
            'comment_count': comments.get(f.key, 0),
            'track_record': records[f.key],
        }
        if f.builtin:
            slug = f.key.split(':', 1)[1]
            item.update({
                'source': 'builtin', 'official': True, 'is_mine': False,
                'can_edit': False, 'can_delete': bool(user.is_staff),
                'summary': '', 'group': BUILTIN_GROUPS.get(slug, 'other'), 'tags': [],
                'visibility': Visibility.INSTANCE, 'author': None,
                'published_at': None, 'forked_from': None,
                **_shape(f.builtin['tasks'], f.builtin['categories']),
            })
        else:
            t = f.saved
            show_name = f.is_mine or t.author_display == ProjectTemplate.AuthorDisplay.NAME
            item.update({
                'source': 'saved', 'id': t.id, 'official': False, 'is_mine': f.is_mine,
                'can_edit': f.is_mine, 'can_delete': f.is_mine,
                'can_unpublish': t.visibility != Visibility.PRIVATE and (f.is_mine or bool(user.is_staff)),
                'summary': t.summary, 'group': t.group, 'tags': t.tags or [],
                'visibility': t.visibility,
                'author': t.owner.username if show_name else None,
                'published_at': t.published_at,
                'forked_from': ({'key': t.forked_from_key, 'name': forks[t.forked_from_key]}
                                if t.forked_from_key in forks else None),
                **_shape(t.tasks, t.categories),
            })
            if f.is_mine:                       # only the owner sees how it is shared
                item.update({
                    'author_display': t.author_display,
                    'share_notes': t.share_notes, 'share_todos': t.share_todos,
                    'shared_with_teams': list(t.shared_with_teams.values_list('id', flat=True)),
                })
        items.append(item)
    return items


def everything_visible(user):
    hidden = hidden_builtin_slugs()
    found = [Resolved(f'builtin:{slug}', builtin=spec, user=user)
             for slug, spec in BUILTIN_TEMPLATES.items() if slug not in hidden]
    found += [Resolved(f'saved:{t.id}', saved=t, user=user)
              for t in visible_templates(user).select_related('owner').prefetch_related('shared_with_teams')]
    return found


SORTS = {
    # "Proven" first: plans that have actually been finished, then the ones people vouch for.
    'proven':  lambda i: (-i['track_record']['finished'], -i['votes'], -i['track_record']['started'], i['name'].lower()),
    'popular': lambda i: (-i['votes'], -i['track_record']['started'], i['name'].lower()),
    'new':     lambda i: (-(i['published_at'].timestamp() if i.get('published_at') else 0), i['name'].lower()),
    'name':    lambda i: i['name'].lower(),
}


def search(items, *, q='', group='', tag='', scope='', sort='proven'):
    q, tag = q.strip().lower(), tag.strip().lower()
    if q:
        items = [i for i in items
                 if q in ' '.join([i['name'], i['description'], i['summary'], ' '.join(i['tags'])]).lower()]
    if group:
        items = [i for i in items if i['group'] == group]
    if tag:
        items = [i for i in items if tag in [t.lower() for t in i['tags']]]
    if scope == 'mine':
        items = [i for i in items if i['is_mine']]
    elif scope == 'shared':
        items = [i for i in items if i['source'] == 'saved' and not i['is_mine']]
    return sorted(items, key=SORTS.get(sort, SORTS['proven']))
