import uuid

from django.conf import settings
from django.db import models


class Project(models.Model):
    name        = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    owner       = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='owned_projects',
    )
    members     = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through='ProjectMembership',
        related_name='projects',
    )
    # The finish date the project is held to. Status reports measure the schedule's current
    # end against it. Optional: without it a report shows planned dates but no variance.
    committed_end = models.DateField(null=True, blank=True)
    # Limits for the status rule, agreed before anything slips. Empty = the defaults in
    # events/status_report.py. Keys: off_track_working_days, off_track_percent, behind_points.
    status_thresholds = models.JSONField(default=dict, blank=True)
    # Provenance: the template this project was started from ("builtin:<slug>" / "saved:<id>") and
    # how long that plan was at the time. It is what a template's track record is computed from
    # (projects/library.py). Blank on projects that were not started from a template.
    source_template_key  = models.CharField(max_length=120, blank=True, default='', db_index=True)
    source_template_span = models.PositiveIntegerField(null=True, blank=True)   # minutes
    # An owner can keep a confidential run out of the template's track record.
    count_in_track_record = models.BooleanField(default=True)
    # An owner answered "Not now" to the close-out offer; it is never offered again by itself.
    closeout_dismissed = models.BooleanField(default=False)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class RunCloseout(models.Model):
    """What a finished (or stopped) project's owner said about the run: how the plan worked, what
    it cost, and what they would change. Every answer is optional. A template shows outcome and
    cost only as totals across its runs, under the rules in ``library.track_records``. The lesson
    is different: it appears on the template's page under "Lessons learned" (section 8 of the
    design), in its writer's words. See docs/design/template-closeout.md."""

    class Outcome(models.TextChoices):
        WORKED       = 'worked',              'It worked'
        WITH_CHANGES = 'worked_with_changes', 'It worked, with changes'
        DID_NOT_WORK = 'did_not_work',        'It did not work'
        STOPPED      = 'stopped',             'We stopped early'

    project   = models.OneToOneField(Project, on_delete=models.CASCADE, related_name='closeout')
    outcome   = models.CharField(max_length=20, choices=Outcome.choices, blank=True, default='')
    cost_amount   = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    cost_currency = models.CharField(max_length=3, blank=True, default='')      # ISO 4217
    effort_person_days = models.DecimalField(max_digits=9, decimal_places=1, null=True, blank=True)
    lesson    = models.TextField(blank=True, default='')
    # "Include my numbers in the template's totals." Off keeps cost and effort on this project only.
    share_figures = models.BooleanField(default=True)
    # Lessons learned. The lesson is shown on the template's page only if it was saved through
    # the dialog that says so; earlier lessons stay where their dialog said they would.
    lesson_public    = models.BooleanField(default=False)
    # Signed with the closer's username, or shown as "Anonymous" to everyone.
    lesson_anonymous = models.BooleanField(default=False)
    # What the template's page calls this lesson, so it never carries a project or close-out id.
    lesson_ref       = models.UUIDField(default=uuid.uuid4, editable=False, db_index=True)
    # Taken down by the template's owner or an admin. The writer keeps it on their project.
    lesson_removed_at = models.DateTimeField(null=True, blank=True)
    lesson_removed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                          null=True, blank=True, related_name='+')
    # Before Lessons learned: "send this to the template's owner" and "also post it as a comment".
    # Nothing sets these any more; they keep the earlier lessons where they were sent.
    lesson_to_owner = models.BooleanField(default=False)
    posted_comment = models.ForeignKey('TemplateComment', on_delete=models.SET_NULL, null=True,
                                       blank=True, related_name='+')
    closed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
                                  related_name='+')
    closed_at  = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'Close-out of {self.project}'


class Role(models.TextChoices):
    OWNER     = 'owner',     'Owner'
    EDITOR    = 'editor',    'Editor'
    COMMENTER = 'commenter', 'Commenter'   # view + comment, but can't edit the timeline
    VIEWER    = 'viewer',    'Viewer'


class ProjectTemplate(models.Model):
    """
    A reusable project blueprint. `categories` and `tasks` are stored as JSON in the
    same shape as the built-in templates (see projects/templates_builtin.py), so the
    instantiate logic treats built-in and saved templates identically.

        categories: [{"name": str, "color": str}]
        tasks:      [{"title", "category", "start_offset_minutes", "duration_minutes",
                      "notes", "is_milestone", "depends_on": [task_index, ...],
                      "todos": [{"title", "due_offset_days"}]}]

    A template is private to its owner until they publish it to the library: to chosen teams or
    to everyone signed in to this instance. Who may see one is decided in one place,
    ``library.visible_templates``. See docs/design/template-library.md.
    """
    class Visibility(models.TextChoices):
        PRIVATE  = 'private',  'Private'
        TEAMS    = 'teams',    'Shared with teams'
        INSTANCE = 'instance', 'Everyone on this instance'

    class Group(models.TextChoices):
        BUSINESS = 'business', 'Business'
        WORK     = 'work',     'Work'
        HOBBY    = 'hobby',    'Hobby'
        OTHER    = 'other',    'Other'

    class AuthorDisplay(models.TextChoices):
        NAME      = 'name',      'Show my name'
        ANONYMOUS = 'anonymous', 'A member'

    name        = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    owner       = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='project_templates',
    )
    categories  = models.JSONField(default=list)
    tasks       = models.JSONField(default=list)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    # --- The library -------------------------------------------------------------------------
    summary     = models.CharField(max_length=200, blank=True, default='')   # one line, for cards
    group       = models.CharField(max_length=10, choices=Group.choices, default=Group.OTHER)
    tags        = models.JSONField(default=list, blank=True)
    visibility  = models.CharField(max_length=10, choices=Visibility.choices, default=Visibility.PRIVATE)
    shared_with_teams = models.ManyToManyField('Team', related_name='shared_templates', blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    author_display = models.CharField(max_length=10, choices=AuthorDisplay.choices,
                                      default=AuthorDisplay.NAME)
    # What other people get. The owner always keeps the full plan; these only filter what is
    # shown to, and copied by, everyone else. A template comes from a real project, so its notes
    # and to-do titles are the likeliest place for something private to be hiding.
    share_notes = models.BooleanField(default=True)
    share_todos = models.BooleanField(default=True)
    # The template this one was copied from ("make my own copy"), as a key, so a copy of a
    # built-in can be recorded too.
    forked_from_key = models.CharField(max_length=120, blank=True, default='')
    # The project this template was saved from. It is the plan's first run: it counts in the track
    # record, and its close-out is the template's first word on cost and outcome. Never copied to
    # a fork, and never shown to anyone.
    origin_project = models.ForeignKey('Project', on_delete=models.SET_NULL, null=True, blank=True,
                                       related_name='templates_saved_from')

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class TemplateVote(models.Model):
    """One upvote per person per template. Keyed by the template key rather than a foreign key so
    built-in templates, which live in code, can be voted on like any other."""
    user         = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                     related_name='template_votes')
    template_key = models.CharField(max_length=120, db_index=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'template_key'], name='uniq_template_vote'),
        ]

    def __str__(self):
        return f'{self.user} +1 {self.template_key}'


class TemplateComment(models.Model):
    """A comment on a template: what worked, what to change, what it assumes. Flat, oldest first.
    Its author, the template's owner, or staff may delete it."""
    template_key = models.CharField(max_length=120, db_index=True)
    author       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                     related_name='template_comments')
    body         = models.TextField()
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'{self.author} on {self.template_key}: {self.body[:40]}'


class TemplateOwnerNote(models.Model):
    """A note from a template's owner, shown first under "Lessons learned" on its page: what no
    single run said. Seven at most, in the owner's order. Copied when the template is copied."""
    MAX_PER_TEMPLATE = 7

    template_key = models.CharField(max_length=120, db_index=True)
    text         = models.CharField(max_length=300)
    position     = models.PositiveSmallIntegerField(default=0)
    created_by   = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
                                     related_name='+')
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['position', 'id']

    def __str__(self):
        return f'{self.template_key}: {self.text[:40]}'


class TemplateReport(models.Model):
    """Someone flagged a published template, a comment on one, or a lesson under its "Lessons
    learned", for staff to look at. Staff review these in the Django admin and can unpublish the
    template, delete the comment or take the lesson down."""
    reporter     = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                     related_name='+')
    template_key = models.CharField(max_length=120, db_index=True)
    comment      = models.ForeignKey(TemplateComment, on_delete=models.CASCADE, null=True, blank=True,
                                     related_name='reports')
    lesson_ref   = models.UUIDField(null=True, blank=True)       # RunCloseout.lesson_ref
    reason       = models.TextField(blank=True, default='')
    created_at   = models.DateTimeField(auto_now_add=True)
    resolved     = models.BooleanField(default=False)

    class Meta:
        ordering = ['resolved', '-created_at']

    def __str__(self):
        return f'{self.template_key} reported by {self.reporter}'


class HiddenBuiltinTemplate(models.Model):
    """A built-in template (from templates_builtin.py) that an admin has retired.

    Built-in templates live in code, not the database, so there's no row to delete — an
    admin "deletes" one by recording its slug here, which hides it globally for everyone.
    Reversible: delete this row (e.g. via the Django admin) to restore the built-in.
    """
    slug       = models.CharField(max_length=100, unique=True)
    hidden_by  = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='+',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.slug


class Team(models.Model):
    """A user-owned, reusable group of people. Adding a team to a project expands its
    current members into individual project memberships (a one-time snapshot)."""
    name        = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    owner       = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='owned_teams',
    )
    members     = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name='teams',
        blank=True,
    )
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class ProjectMembership(models.Model):
    user      = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='memberships',
    )
    project   = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name='memberships',
    )
    role      = models.CharField(max_length=10, choices=Role.choices, default=Role.VIEWER)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['joined_at']
        constraints = [
            models.UniqueConstraint(fields=['user', 'project'], name='uniq_user_project_membership'),
        ]

    def __str__(self):
        return f'{self.user} @ {self.project} ({self.role})'


class ProjectTeam(models.Model):
    """A live, graded assignment of a Team to a Project.

    Unlike the old snapshot expansion (which copied a team's members into individual
    ProjectMembership rows), access here is resolved from the team's CURRENT membership at
    request time — see permissions.get_role. Adding or removing a team member therefore
    changes project access immediately, with no drift. Team grants are capped at Editor
    (ownership is always an individual, direct ProjectMembership). See docs/PERMISSIONS.md.
    """
    project  = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='team_links')
    team     = models.ForeignKey(Team, on_delete=models.CASCADE, related_name='project_links')
    role     = models.CharField(max_length=10, choices=Role.choices, default=Role.VIEWER)
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['added_at']
        constraints = [
            models.UniqueConstraint(fields=['project', 'team'], name='uniq_project_team'),
        ]

    def __str__(self):
        return f'{self.team} -> {self.project} ({self.role})'


class EffectiveAccessReport(Project):
    """Table-less proxy used only to surface a read-only 'Effective access' report page in
    the Django admin (rendered by projects/admin.py). Has no data of its own."""
    class Meta:
        proxy = True
        verbose_name = 'Effective access'
        verbose_name_plural = 'Effective access'
