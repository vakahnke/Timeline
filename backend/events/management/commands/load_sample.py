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

# Sub-tasks and a comment thread added to the first in-flight event of each
# template project, so the task panel, board, and comments have content.
SAMPLE_TASKS = [
    ('Outline the approach',      Task.Status.DONE,        'demo'),
    ('Review with the team',      Task.Status.IN_PROGRESS, 'editor'),
    ('Write up the result',       Task.Status.TODO,        'editor'),
    ('Confirm the next step',     Task.Status.TODO,        'demo'),
]
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
            in_flight = None
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

            # Sub-tasks and a comment thread on one event so the board and panels have content.
            target = in_flight or next((ev for ev in events if ev.start > now), None)
            if target is not None:
                for order, (title, status, assignee) in enumerate(SAMPLE_TASKS):
                    Task.objects.create(
                        event=target, title=title, status=status, order=order,
                        owner=owner, assignee=users[assignee],
                        due_date=(timezone.localdate() + timedelta(days=2 + order)),
                    )
                for author, body in SAMPLE_COMMENTS:
                    Comment.objects.create(event=target, author=users[author], body=body)

            self.stdout.write(self.style.SUCCESS(
                f'Seeded "{spec["name"]}" from template ({len(events)} events, '
                f'starting {weeks:+d} weeks from today).'
            ))
