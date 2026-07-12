"""Comments on events + the Commenter role (view + comment, but can't edit the timeline).
See docs/PERMISSIONS.md."""
from datetime import datetime, timezone as tz

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from projects.models import Project, ProjectMembership, ProjectTeam, Role, Team
from events.models import Event

User = get_user_model()

NEW_EVENT = {'title': 'X', 'start': '2026-07-02T09:00:00Z', 'end': '2026-07-02T10:00:00Z', 'category': 'Default'}


class CommentTests(APITestCase):
    def setUp(self):
        self.owner     = User.objects.create_user('owner', 'o@x.com', 'pw')
        self.editor    = User.objects.create_user('ed',    'e@x.com', 'pw')
        self.commenter = User.objects.create_user('carl',  'c@x.com', 'pw')
        self.viewer    = User.objects.create_user('val',   'v@x.com', 'pw')
        self.outsider  = User.objects.create_user('out',   'x@x.com', 'pw')
        self.project = Project.objects.create(name='P', owner=self.owner)
        for u, r in [(self.owner, Role.OWNER), (self.editor, Role.EDITOR),
                     (self.commenter, Role.COMMENTER), (self.viewer, Role.VIEWER)]:
            ProjectMembership.objects.create(project=self.project, user=u, role=r)
        self.event = Event.objects.create(
            project=self.project, title='E',
            start=datetime(2026, 7, 1, 9, tzinfo=tz.utc), end=datetime(2026, 7, 1, 10, tzinfo=tz.utc))

    def curl(self):         return f'/api/projects/{self.project.id}/events/{self.event.id}/comments/'
    def cdetail(self, cid): return f'/api/projects/{self.project.id}/events/{self.event.id}/comments/{cid}/'
    def eurl(self):         return f'/api/projects/{self.project.id}/events/'

    def post_comment(self, user, body='hi'):
        self.client.force_authenticate(user)
        return self.client.post(self.curl(), {'body': body}, format='json')

    # ── who can comment ───────────────────────────────────────────────────────
    def test_commenter_editor_owner_can_post(self):
        for u in (self.commenter, self.editor, self.owner):
            self.assertEqual(self.post_comment(u).status_code, 201, u.username)

    def test_viewer_cannot_post(self):
        self.assertEqual(self.post_comment(self.viewer).status_code, 403)

    def test_outsider_cannot_read_or_post(self):
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.get(self.curl()).status_code, 403)
        self.assertEqual(self.post_comment(self.outsider).status_code, 403)

    def test_any_member_can_read(self):
        self.post_comment(self.commenter, 'seen')
        for u in (self.owner, self.editor, self.commenter, self.viewer):
            self.client.force_authenticate(u)
            res = self.client.get(self.curl())
            self.assertEqual((res.status_code, len(res.data)), (200, 1), u.username)

    def test_empty_body_rejected(self):
        self.assertEqual(self.post_comment(self.commenter, '   ').status_code, 400)

    # ── the Commenter tier: comment yes, edit the timeline no ─────────────────
    def test_commenter_cannot_edit_events(self):
        self.client.force_authenticate(self.commenter)
        self.assertEqual(self.client.post(self.eurl(), NEW_EVENT, format='json').status_code, 403)

    # ── edit / delete / moderation ────────────────────────────────────────────
    def test_author_edits_and_deletes_own(self):
        cid = self.post_comment(self.commenter, 'draft').data['id']
        self.client.force_authenticate(self.commenter)
        r = self.client.patch(self.cdetail(cid), {'body': 'final'}, format='json')
        self.assertEqual((r.status_code, r.data['body']), (200, 'final'))
        self.assertEqual(self.client.delete(self.cdetail(cid)).status_code, 204)

    def test_other_member_cannot_edit_or_delete(self):
        cid = self.post_comment(self.commenter, 'mine').data['id']
        self.client.force_authenticate(self.editor)                    # a different member
        self.assertEqual(self.client.patch(self.cdetail(cid), {'body': 'hax'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(self.cdetail(cid)).status_code, 403)

    def test_owner_can_delete_any(self):
        cid = self.post_comment(self.commenter, 'mod me').data['id']
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.delete(self.cdetail(cid)).status_code, 204)

    # ── role reconciliation: commenter via a team ─────────────────────────────
    def test_team_commenter_can_comment_but_not_edit(self):
        u = User.objects.create_user('reviewer', 'r@x.com', 'pw')
        team = Team.objects.create(name='Reviewers', owner=self.owner)
        team.members.add(u)
        ProjectTeam.objects.create(project=self.project, team=team, role=Role.COMMENTER)
        self.assertEqual(self.post_comment(u).status_code, 201)        # can comment via team
        self.client.force_authenticate(u)
        self.assertEqual(self.client.post(self.eurl(), NEW_EVENT, format='json').status_code, 403)  # not edit
