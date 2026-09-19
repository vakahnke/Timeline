from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from events.models import Category, Comment, Event, Task
from projects.models import Project, ProjectMembership, Role
from projects.templates import create_project_from_spec
from projects.templates_builtin import BUILTIN_TEMPLATES

User = get_user_model()

# The single-day sample below was authored for this date; it is shifted to "today"
# at load time so the timeline opens on something current.
SAMPLE_DAY = date(2026, 3, 7)

SAMPLE_EVENTS = [
    # ── Engineering ──────────────────────────────────────────────────────────
    dict(title='Team Standup',        start='2026-03-07T09:00:00Z', end='2026-03-07T09:30:00Z', category='Engineering', color='#4a88ff', notes='Daily sync — blockers & updates.'),
    dict(title='Sprint Planning',     start='2026-03-07T10:00:00Z', end='2026-03-07T12:00:00Z', category='Engineering', color='#4a88ff', notes='Plan tickets for the upcoming sprint.'),
    dict(title='Lunch',               start='2026-03-07T12:00:00Z', end='2026-03-07T13:00:00Z', category='Engineering', color='#4a88ff', notes=''),
    dict(title='Code Review',         start='2026-03-07T13:30:00Z', end='2026-03-07T15:30:00Z', category='Engineering', color='#4a88ff', notes='Review open PRs before end of day.'),
    dict(title='Deploy to Staging',   start='2026-03-07T16:00:00Z', end='2026-03-07T17:00:00Z', category='Engineering', color='#4a88ff', notes='Deploy v2.4.1-rc1.'),

    # ── Product ───────────────────────────────────────────────────────────────
    dict(title='Product Sync',        start='2026-03-07T09:30:00Z', end='2026-03-07T10:30:00Z', category='Product',     color='#ff6b4a', notes='Align on Q2 priorities.'),
    dict(title='User Research Review',start='2026-03-07T11:00:00Z', end='2026-03-07T13:00:00Z', category='Product',     color='#ff6b4a', notes='Review session recordings and synthesise findings.'),
    dict(title='Roadmap Review',      start='2026-03-07T14:00:00Z', end='2026-03-07T16:30:00Z', category='Product',     color='#ff6b4a', notes='Update roadmap for stakeholder presentation.'),

    # ── Design ───────────────────────────────────────────────────────────────
    dict(title='Design Review',       start='2026-03-07T09:00:00Z', end='2026-03-07T10:30:00Z', category='Design',      color='#c44aff', notes='Review new onboarding flow mockups.'),
    dict(title='Wireframing',         start='2026-03-07T11:00:00Z', end='2026-03-07T14:00:00Z', category='Design',      color='#c44aff', notes='Dashboard redesign wireframes.'),
    dict(title='Stakeholder Sync',    start='2026-03-07T15:00:00Z', end='2026-03-07T16:00:00Z', category='Design',      color='#c44aff', notes='Present designs to leadership.'),

    # ── QA ───────────────────────────────────────────────────────────────────
    dict(title='Bug Triage',          start='2026-03-07T09:00:00Z', end='2026-03-07T10:00:00Z', category='QA',          color='#4aff9e', notes='Triage and prioritise incoming bug reports.'),
    dict(title='Regression Testing',  start='2026-03-07T10:30:00Z', end='2026-03-07T13:00:00Z', category='QA',          color='#4aff9e', notes='Run full regression suite against staging.'),
    dict(title='Release Sign-off',    start='2026-03-07T15:30:00Z', end='2026-03-07T17:00:00Z', category='QA',          color='#4aff9e', notes='Final approval before production deploy.'),

    # ── Marketing ─────────────────────────────────────────────────────────────
    dict(title='Campaign Briefing',   start='2026-03-07T09:00:00Z', end='2026-03-07T10:00:00Z', category='Marketing',   color='#ffd84a', notes='Brief agency on Q2 campaign.'),
    dict(title='Content Review',      start='2026-03-07T10:30:00Z', end='2026-03-07T12:00:00Z', category='Marketing',   color='#ffd84a', notes='Review blog posts and social copy.'),
    dict(title='Analytics Deep-dive', start='2026-03-07T13:00:00Z', end='2026-03-07T15:00:00Z', category='Marketing',   color='#ffd84a', notes='Monthly performance review — GA4 & Mixpanel.'),
    dict(title='Launch Prep',         start='2026-03-07T15:30:00Z', end='2026-03-07T17:00:00Z', category='Marketing',   color='#ffd84a', notes='Coordinate launch announcement assets.'),
]

DEMO_USERS = [
    # username, email, password, role on the demo project
    ('demo',   'demo@example.com',   'demo12345', Role.OWNER),
    ('editor', 'editor@example.com', 'demo12345', Role.EDITOR),
    ('viewer', 'viewer@example.com', 'demo12345', Role.VIEWER),
]

# Multi-week projects instantiated from built-in templates, anchored relative to
# today (in weeks) so some work is done, some is in flight, and some is upcoming.
TEMPLATE_PROJECTS = [
    # template slug,        start offset in weeks
    ('startup_mvp',         -5),
    ('seed_round',          -8),
    ('gtm_launch',          +1),
]

# Key milestones (matched on the start of the event title) and the committed finish date, given as
# days relative to the schedule's own end. They make the status report meaningful out of the box:
# the MVP project is committed three days earlier than it is planned to finish, so it reads
# "at risk, +3 days"; the seed round is committed exactly to plan.
SAMPLE_REPORTING = {
    'startup_mvp': {'commit_offset_days': -3, 'milestones': [
        'Synthesize findings', 'Define MVP scope', 'Build the core flow', 'Private beta', 'Public launch']},
    'seed_round': {'commit_offset_days': 0, 'milestones': [
        'Pitch deck', 'First-meeting sprint', 'Secure a lead investor', 'Sign, wire & close']},
    'gtm_launch': {'commit_offset_days': None, 'milestones': [
        'Pricing tiers', 'Train sales', 'Launch day']},
}

# Sub-task sets spread over the in-flight and next upcoming events of each template
# project (one set per event, cycling), so the board and task panels have content.
SAMPLE_TASK_SETS = [
    [
        ('Outline the approach',          Task.Status.DONE,        'demo'),
        ('Review with the team',          Task.Status.IN_PROGRESS, 'editor'),
        ('Write up the result',           Task.Status.TODO,        'editor'),
        ('Confirm the next step',         Task.Status.TODO,        'demo'),
    ],
    [
        ('Draft the checklist',           Task.Status.DONE,        'editor'),
        ('Collect feedback from the team', Task.Status.IN_PROGRESS, 'demo'),
        ('Waiting on the vendor quote',   Task.Status.BLOCKED,     'editor'),
    ],
    [
        ('Book the kickoff meeting',      Task.Status.TODO,        'demo'),
        ('Prepare the one-page brief',    Task.Status.TODO,        'editor'),
        ('Share the numbers with finance', Task.Status.IN_PROGRESS, 'demo'),
    ],
]
# A short comment thread on the first in-flight event.
SAMPLE_COMMENTS = [
    ('editor', 'Started on this today. First pass is in the shared doc if anyone wants to look early.'),
    ('demo',   'Looks good so far. Let\'s keep the scope tight and review on Thursday.'),
]


class Command(BaseCommand):
    help = 'Seed demo users, a one-day Demo Project, and three template-based startup projects.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Delete the demo project (and its events/categories) before reseeding.',
        )

    def handle(self, *args, **options):
        # Demo users
        users = {}
        for username, email, password, _role in DEMO_USERS:
            user, created = User.objects.get_or_create(
                username=username, defaults={'email': email},
            )
            if created:
                user.set_password(password)
                user.save(update_fields=['password'])
                self.stdout.write(self.style.SUCCESS(f'Created user "{username}" (password: {password}).'))
            users[username] = user

        owner = users['demo']

        if options['clear']:
            names = ['Demo Project'] + [BUILTIN_TEMPLATES[slug]['name'] for slug, _ in TEMPLATE_PROJECTS]
            deleted, _ = Project.objects.filter(name__in=names, owner=owner).delete()
            if deleted:
                self.stdout.write(self.style.WARNING('Cleared existing sample projects.'))

        project, created = Project.objects.get_or_create(
            name='Demo Project', owner=owner,
            defaults={'description': 'A sample timeline to explore the app.'},
        )
        if not created and not options['clear']:
            self.stdout.write(self.style.WARNING('Demo Project already exists; use --clear to reseed.'))
            return

        # Memberships
        for username, _email, _password, role in DEMO_USERS:
            ProjectMembership.objects.get_or_create(
                project=project, user=users[username], defaults={'role': role},
            )

        # Categories (project-scoped, unique per project)
        cat_colors = {}
        for data in SAMPLE_EVENTS:
            cat_colors.setdefault(data['category'], data['color'])
        for name, color in cat_colors.items():
            Category.objects.get_or_create(project=project, name=name, defaults={'color': color})

        # Events (shifted from SAMPLE_DAY to today)
        shift = timezone.localdate() - SAMPLE_DAY
        created_events = 0
        for data in SAMPLE_EVENTS:
            Event.objects.create(
                project=project,
                title=data['title'],
                start=parse_datetime(data['start']) + shift,
                end=parse_datetime(data['end']) + shift,
                category=data['category'],
                color=data['color'],
                notes=data.get('notes', ''),
            )
            created_events += 1

        self.stdout.write(self.style.SUCCESS(
            f'Seeded "Demo Project" with {len(cat_colors)} categories and {created_events} events. '
            f'Owner: demo / Editor: editor / Viewer: viewer (password: demo12345).'
        ))

        self._seed_template_projects(users)

    def _seed_report_history(self, project, owner, events, now):
        """A baseline and three earlier status reports, so slip, what moved and the milestone
        trend can be switched on in the sample (they are opt-in and start switched off). The story: the plan was approved six weeks ago; the
        unfinished work has since slipped three days, one of them before the last report."""
        import copy
        from datetime import datetime

        from events.models import Baseline, StatusReport
        from events.status_report import build_facts, suggest

        open_ids = {e.id for e in events if e.end > now}

        def shift(iso, days):
            return (datetime.fromisoformat(iso) + timedelta(days=days)).isoformat()

        base = Baseline.objects.create(
            project=project, name='Approved plan', created_by=owner, active=True, committed_end=project.committed_end,
            planned_start=min(e.start for e in events),
            planned_end=max(e.end for e in events) - timedelta(days=3),
            events={str(e.id): {'title': e.title, 'category': e.category, 'is_milestone': e.is_milestone,
                                'start': (e.start - timedelta(days=3 if e.id in open_ids else 0)).isoformat(),
                                'end': (e.end - timedelta(days=3 if e.id in open_ids else 0)).isoformat()} for e in events})
        Baseline.objects.filter(pk=base.pk).update(created_at=now - timedelta(days=42))

        for days_ago, slip_then, progress in ((42, -3, 8), (28, -3, 22), (14, -2, 33)):
            when = now - timedelta(days=days_ago)
            snap = copy.deepcopy(build_facts(project, now=when))
            for key in ('events', 'milestones'):
                for e in snap[key]:
                    if e['id'] in open_ids:
                        e['start'], e['end'] = shift(e['start'], slip_then), shift(e['end'], slip_then)
                        if 'date' in e:
                            e['date'] = e['end']
            snap['end'] = shift(snap['end'], slip_then)
            snap['progress'] = progress
            snap['variance_days'] = 3 + slip_then
            snap['variance_working_days'] = 3 + slip_then
            verdict = suggest(snap)
            StatusReport.objects.create(
                project=project, author=owner, as_of=when, layout='slide', status=verdict['status'],
                suggested_status=verdict['status'], status_source='rule', rule_fired=verdict['rule_fired'], snapshot=snap,
                content={
                    'v': 1,
                    'header': {'project': project.name, 'subtitle': 'Status report', 'date': f'{when:%b} {when.day}, {when.year}', 'pm': 'PM: demo'},
                    'headline': verdict['headline'], 'pathToGreen': '', 'moved': '',
                    'show': {'pathToGreen': True, 'decision': True, 'kpis': True, 'timeline': True, 'baseline': False, 'moved': False,
                             'trend': False, 'columns': True, 'milestoneTable': True, 'footer': True},
                    'decision': {'none': slip_then == -3, 'title': 'Decision needed', 'neededBy': '', 'from': 'the sponsor',
                                 'text': '' if slip_then == -3 else 'Shorten the private beta from 14 to 10 days to hold the committed launch? Each week undecided costs about two days.'},
                    'kpis': [], 'hiddenKpis': [],
                    'timeline': {'hiddenRows': [], 'milestoneIds': None, 'showCritical': True, 'showProgress': True},
                    'columns': [] if slip_then == -3 else [
                        {'id': 'done', 'kind': 'list', 'mark': '✓', 'title': 'Since last report', 'source': 'completed', 'items': []},
                        {'id': 'next', 'kind': 'list', 'mark': '›', 'title': 'Next three weeks', 'source': 'next', 'items': []},
                        {'id': 'risks', 'kind': 'risks', 'title': 'Top risks · impact · owner · mitigation', 'items': [
                            {'id': 'r1', 'severity': 'high', 'text': 'Core flow build is behind, on the critical path: launch slips day for day.', 'detail': 'E. Editor · cut the settings page from beta'},
                            {'id': 'r2', 'severity': 'medium', 'text': 'Billing vendor quote is blocked.', 'detail': 'E. Editor · hosted checkout as fallback'}]}],
                    'footer': {'text': ''},
                })

    def _seed_template_projects(self, users):
        """Instantiate a few built-in templates for the demo owner, relative to today."""
        now = timezone.now()
        anchor = timezone.localtime(now).replace(hour=9, minute=0, second=0, microsecond=0)
        owner = users['demo']

        for slug, weeks in TEMPLATE_PROJECTS:
            spec = BUILTIN_TEMPLATES[slug]
            if Project.objects.filter(name=spec['name'], owner=owner).exists():
                self.stdout.write(self.style.WARNING(f'"{spec["name"]}" already exists; skipping.'))
                continue

            project = create_project_from_spec(
                spec, name=spec['name'], description=spec['description'],
                start=anchor + timedelta(weeks=weeks), owner=owner,
            )
            for username, _email, _password, role in DEMO_USERS:
                ProjectMembership.objects.get_or_create(
                    project=project, user=users[username], defaults={'role': role},
                )

            # Progress: finished events are 100%, in-flight ones proportional to elapsed time.
            events = list(Event.objects.filter(project=project).order_by('start', 'id'))

            # Key milestones and the committed finish date, for the status report.
            reporting = SAMPLE_REPORTING.get(slug, {})
            for prefix in reporting.get('milestones', []):
                Event.objects.filter(project=project, title__startswith=prefix).update(is_milestone=True)
            offset = reporting.get('commit_offset_days')
            if offset is not None and events:
                planned_end = timezone.localtime(max(e.end for e in events)).date()
                project.committed_end = planned_end + timedelta(days=offset)
                project.save(update_fields=['committed_end'])
            in_flight = None
            history_events = events if slug == 'startup_mvp' else None
            for ev in events:
                if ev.end <= now:
                    ev.percent_complete = 100
                elif ev.start <= now:
                    elapsed = (now - ev.start) / (ev.end - ev.start)
                    ev.percent_complete = max(5, min(95, int(100 * elapsed)))
                    in_flight = in_flight or ev
                else:
                    continue
                ev.save(update_fields=['percent_complete'])

            # Sub-tasks on the in-flight events and the next few upcoming ones, plus a
            # comment thread on the first in-flight event, so the board and panels have content.
            active = [ev for ev in events if ev.start <= now < ev.end]
            upcoming = [ev for ev in events if ev.start > now]
            targets = (active + upcoming)[:len(SAMPLE_TASK_SETS)]
            for n, target in enumerate(targets):
                for order, (title, status, assignee) in enumerate(SAMPLE_TASK_SETS[n]):
                    Task.objects.create(
                        event=target, title=title, status=status, order=order,
                        owner=owner, assignee=users[assignee],
                        due_date=(timezone.localdate() + timedelta(days=2 + order + 3 * n)),
                    )
            if in_flight is not None:
                for author, body in SAMPLE_COMMENTS:
                    Comment.objects.create(event=in_flight, author=users[author], body=body)
            if history_events:
                self._seed_report_history(project, owner, history_events, now)

            self.stdout.write(self.style.SUCCESS(
                f'Seeded "{spec["name"]}" from template ({len(events)} events, '
                f'starting {weeks:+d} weeks from today).'
            ))
