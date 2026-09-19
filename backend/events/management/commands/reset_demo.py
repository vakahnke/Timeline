from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = (
        'Hard-reset a public demo instance: wipe every table (users, projects, teams, '
        'everything) and reseed the sample users and projects. Run on a schedule.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--yes', action='store_true',
            help='Required. This destroys all data in the configured database.',
        )

    def handle(self, *args, **options):
        if not options['yes']:
            self.stderr.write('Refusing to wipe the database without --yes.')
            return
        self.stdout.write('Flushing all tables...')
        call_command('flush', interactive=False, verbosity=0)
        self.stdout.write('Reseeding sample data...')
        call_command('load_sample')
        self.stdout.write(self.style.SUCCESS('Demo reset complete.'))
