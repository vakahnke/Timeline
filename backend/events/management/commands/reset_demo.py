import os

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.db.migrations.loader import MigrationLoader


class Command(BaseCommand):
    help = (
        'Hard-reset a PUBLIC DEMO instance: wipe every table (users, projects, teams, '
        'everything) and reseed the sample users and projects. Run on a schedule on the '
        'demo host only. Refuses to run unless ALLOW_DEMO_RESET=1 is set in the environment.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--yes', action='store_true',
            help='Required. This destroys all data in the configured database.',
        )

    def handle(self, *args, **options):
        # Two independent locks. The environment variable is the important one: it is set on
        # the demo host's reset service and nowhere else, so this command cannot wipe a real
        # instance even if someone runs it there by hand, from a copied cron line, or by habit.
        if os.environ.get('ALLOW_DEMO_RESET') != '1':
            raise CommandError(
                'Refusing to run: ALLOW_DEMO_RESET=1 is not set. This command deletes ALL data '
                'and is only for the public demo instance.'
            )
        if not options['yes']:
            raise CommandError('Refusing to wipe the database without --yes.')

        self._refuse_if_out_of_step()
        self.stdout.write('Flushing all tables...')
        call_command('flush', interactive=False, verbosity=0)
        self.stdout.write('Reseeding sample data...')
        call_command('load_sample')
        self.stdout.write(self.style.SUCCESS('Demo reset complete.'))

    def _refuse_if_out_of_step(self):
        """The reset runs as its own Railway service, built from its own upload of the code. If the
        web service was deployed with a migration this build does not have, ``flush`` truncates
        the tables THIS code knows and Postgres refuses, because the newer table references one
        of them ("cannot truncate a table referenced in a foreign key constraint"). That crashed
        the demo's reset every six hours in September 2026. Check first, touch nothing, and say
        what to do. The other direction (a migration this build has that the database has not
        applied) is refused too: ``load_sample`` would write columns that are not there."""
        loader = MigrationLoader(connection)
        recorded = set(loader.applied_migrations)
        known = set(loader.graph.nodes)
        unknown = sorted(recorded - known)
        unapplied = sorted(known - recorded)
        if unknown:
            raise CommandError(
                'Refusing to reset: the database has migrations this build does not know '
                f'({", ".join(f"{app}.{name}" for app, name in unknown)}). The reset service is '
                'running older code than the web service. Deploy both from the same tree: '
                '`railway up --service web` and `railway up --service reset`.'
            )
        if unapplied:
            raise CommandError(
                'Refusing to reset: this build has migrations the database has not applied '
                f'({", ".join(f"{app}.{name}" for app, name in unapplied)}). Deploy the web '
                'service from the same tree first; it runs `migrate` on start.'
            )
