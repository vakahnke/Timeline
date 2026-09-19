import os

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError


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

        self.stdout.write('Flushing all tables...')
        call_command('flush', interactive=False, verbosity=0)
        self.stdout.write('Reseeding sample data...')
        call_command('load_sample')
        self.stdout.write(self.style.SUCCESS('Demo reset complete.'))
