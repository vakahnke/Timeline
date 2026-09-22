import os
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, TransactionTestCase

from projects.models import Project

User = get_user_model()


class ResetDemoGuardTests(TestCase):
    """reset_demo wipes the whole database, so it must be impossible to run by accident."""

    def setUp(self):
        self.user = User.objects.create_user('realperson', 'real@example.com', 'a-real-Passw0rd')
        self.project = Project.objects.create(name='Real project', owner=self.user)

    def assertDataIntact(self):
        self.assertTrue(User.objects.filter(username='realperson').exists())
        self.assertTrue(Project.objects.filter(name='Real project').exists())

    def test_refuses_without_the_environment_flag_even_with_yes(self):
        env = {k: v for k, v in os.environ.items() if k != 'ALLOW_DEMO_RESET'}
        with mock.patch.dict(os.environ, env, clear=True):
            with self.assertRaises(CommandError) as ctx:
                call_command('reset_demo', '--yes', stdout=StringIO())
        self.assertIn('ALLOW_DEMO_RESET', str(ctx.exception))
        self.assertDataIntact()

    def test_refuses_when_the_flag_has_any_other_value(self):
        for value in ('0', 'true', 'yes', ''):
            with mock.patch.dict(os.environ, {'ALLOW_DEMO_RESET': value}):
                with self.assertRaises(CommandError):
                    call_command('reset_demo', '--yes', stdout=StringIO())
        self.assertDataIntact()

    def test_refuses_with_the_flag_but_without_yes(self):
        with mock.patch.dict(os.environ, {'ALLOW_DEMO_RESET': '1'}):
            with self.assertRaises(CommandError):
                call_command('reset_demo', stdout=StringIO())
        self.assertDataIntact()

    def test_refuses_when_the_database_is_ahead_of_this_code(self):
        """The reset service was built before the web service's last migration (Railway, Sept
        2026): its flush would fail on a foreign key from the table it does not know. It must
        say so before touching anything."""
        from django.db.migrations.recorder import MigrationRecorder
        MigrationRecorder.Migration.objects.create(app='projects', name='9999_from_a_newer_build')
        with mock.patch.dict(os.environ, {'ALLOW_DEMO_RESET': '1'}):
            with self.assertRaises(CommandError) as ctx:
                call_command('reset_demo', '--yes', stdout=StringIO())
        msg = str(ctx.exception)
        self.assertIn('projects.9999_from_a_newer_build', msg)
        self.assertIn('railway up --service reset', msg)
        self.assertDataIntact()

    def test_refuses_when_this_code_is_ahead_of_the_database(self):
        from django.db.migrations.recorder import MigrationRecorder
        latest = MigrationRecorder.Migration.objects.filter(app='projects').order_by('-id').first()
        latest.delete()                                   # rolled back with the test
        with mock.patch.dict(os.environ, {'ALLOW_DEMO_RESET': '1'}):
            with self.assertRaises(CommandError) as ctx:
                call_command('reset_demo', '--yes', stdout=StringIO())
        self.assertIn(f'projects.{latest.name}', str(ctx.exception))
        self.assertDataIntact()


class ResetDemoRunsTests(TransactionTestCase):
    """The positive path. `flush` truncates tables, which cannot run inside the transaction a
    plain TestCase wraps around each test, hence TransactionTestCase."""

    def test_runs_only_with_both_locks_open(self):
        user = User.objects.create_user('realperson', 'real@example.com', 'a-real-Passw0rd')
        Project.objects.create(name='Real project', owner=user)
        with mock.patch.dict(os.environ, {'ALLOW_DEMO_RESET': '1'}):
            call_command('reset_demo', '--yes', stdout=StringIO())
        self.assertFalse(User.objects.filter(username='realperson').exists())
        self.assertFalse(Project.objects.filter(name='Real project').exists())
        self.assertTrue(User.objects.filter(username='demo').exists())
