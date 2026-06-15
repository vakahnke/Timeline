from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils.dateparse import parse_datetime

from events.models import Category, Event
from projects.models import Project, ProjectMembership, Role

User = get_user_model()

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


class Command(BaseCommand):
    help = 'Seed a demo user, a demo project (with members) and a sample timeline.'

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
            deleted, _ = Project.objects.filter(name='Demo Project', owner=owner).delete()
            if deleted:
                self.stdout.write(self.style.WARNING('Cleared existing Demo Project.'))

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

        # Events
        created_events = 0
        for data in SAMPLE_EVENTS:
            Event.objects.create(
                project=project,
                title=data['title'],
                start=parse_datetime(data['start']),
                end=parse_datetime(data['end']),
                category=data['category'],
                color=data['color'],
                notes=data.get('notes', ''),
            )
            created_events += 1

        self.stdout.write(self.style.SUCCESS(
            f'Seeded "Demo Project" with {len(cat_colors)} categories and {created_events} events. '
            f'Owner: demo / Editor: editor / Viewer: viewer (password: demo12345).'
        ))
