"""The product's name comes from one setting, APP_NAME, wherever the server says it.

These tests rename the product to something unmistakable and check that every outgoing surface
follows, and that the word "Timeline" survives only where it means the timeline VIEW.
"""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone

from events.ical_export import build_ics
from events.models import Event
from projects import emails
from projects.models import Project

User = get_user_model()
NAME = 'Harbour Test Name'


@override_settings(APP_NAME=NAME, ACCOUNT_NOTIFY_EMAIL='ops@example.com', EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class AppNameTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('nora', 'nora@example.com', 'pw')

    def test_every_email_uses_it(self):
        emails.notify_admin_new_registration(self.user)
        emails.send_password_reset_link(self.user, 'uid', 'token')
        emails.send_password_changed_notice(self.user)
        self.assertEqual(len(mail.outbox), 3)
        for message in mail.outbox:
            self.assertIn(NAME, message.subject)
            self.assertNotIn('Timeline', message.subject + message.body)

    def test_the_calendar_file_uses_it(self):
        project = Project.objects.create(name='P', owner=self.user)
        now = timezone.now()
        Event.objects.create(project=project, title='E', start=now, end=now + timedelta(hours=1))
        ics = build_ics(project, project.events.all(), host='example.com').decode()
        self.assertIn(f'PRODID:-//{NAME}//EN', ics)

    def test_the_timeline_view_keeps_its_name(self):
        """The grouped shape in an exported slide is named for the timeline VIEW, not the product."""
        import inspect
        from events import pptx_export
        self.assertIn("_describe(grp, 'Timeline'", inspect.getsource(pptx_export))
