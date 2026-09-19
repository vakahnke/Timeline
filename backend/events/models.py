from django.conf import settings
from django.db import models

from projects.models import Project


class Category(models.Model):
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name='categories',
    )
    name  = models.CharField(max_length=100)
    color = models.CharField(max_length=7, blank=True, default='')

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(fields=['project', 'name'], name='uniq_category_name_per_project'),
        ]

    def __str__(self):
        return self.name


class Event(models.Model):
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name='events',
    )
    title = models.CharField(max_length=200)
    start = models.DateTimeField()
    end   = models.DateTimeField()
    category = models.CharField(max_length=100, default='Default')  # free-text label, scoped by project
    color = models.CharField(max_length=7, blank=True, default='')  # hex e.g. #4a88ff
    notes             = models.TextField(blank=True, default='')
    percent_complete  = models.PositiveSmallIntegerField(default=0)
    # A date leadership tracks. Drawn as a diamond and listed on the status report.
    is_milestone      = models.BooleanField(default=False)
    depends_on = models.ManyToManyField('self', symmetrical=False, blank=True, related_name='dependents')

    class Meta:
        ordering = ['start']

    def __str__(self):
        return f'{self.title} ({self.category})'


class Task(models.Model):
    """A unit of work inside an Event. Owned by one person and assigned to one person
    for action (assignee defaults to the owner)."""

    class Status(models.TextChoices):
        TODO        = 'todo',        'To do'
        IN_PROGRESS = 'in_progress', 'In progress'
        BLOCKED     = 'blocked',     'Blocked'
        DONE        = 'done',        'Done'

    event    = models.ForeignKey(
        Event,
        on_delete=models.CASCADE,
        related_name='tasks',
    )
    title    = models.CharField(max_length=200)
    status   = models.CharField(max_length=20, choices=Status.choices, default=Status.TODO)
    owner    = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='owned_tasks',
    )
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='assigned_tasks',
    )
    due_date   = models.DateField(null=True, blank=True)
    order      = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self):
        return f'{self.title} [{self.status}]'

    @property
    def project_id(self):
        # Lets IsProjectMember (which expects obj.project_id) authorize tasks via their
        # event's project. Free when the queryset select_related's 'event'.
        return self.event.project_id


class Comment(models.Model):
    """A discussion comment on an event. Anyone with Viewer+ can read; Commenter+ can post
    (the Commenter role's whole purpose). Authors edit/delete their own; owners moderate."""
    event      = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='comments')
    author     = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='comments')
    body       = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'{self.author} on {self.event_id}: {self.body[:40]}'

    @property
    def project_id(self):
        return self.event.project_id


class StatusReport(models.Model):
    """A saved one-page status report for a project (docs/design/status-one-pager.md).

    ``content`` is the page as the author left it: every block's text, which blocks are shown,
    their titles and order. It is owned by the print tool in the frontend, so the page can be
    customized per project without a migration. ``snapshot`` freezes the computed facts at the
    moment of saving, which makes a report reproducible and gives the next one something to
    compare against ("since last report", trend).
    """

    class Status(models.TextChoices):
        ON_TRACK  = 'on_track',  'On track'
        AT_RISK   = 'at_risk',   'At risk'
        OFF_TRACK = 'off_track', 'Off track'

    class Source(models.TextChoices):
        RULE     = 'rule',     'Derived by rule'
        OVERRIDE = 'override', 'Set by the author'

    class Layout(models.TextChoices):
        SLIDE   = 'slide',   '16:9 slide'
        HANDOUT = 'handout', 'Portrait handout'

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='status_reports')
    author  = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
                                related_name='status_reports')
    as_of   = models.DateTimeField()
    layout  = models.CharField(max_length=10, choices=Layout.choices, default=Layout.SLIDE)
    status          = models.CharField(max_length=10, choices=Status.choices)
    status_source   = models.CharField(max_length=10, choices=Source.choices, default=Source.RULE)
    override_reason = models.CharField(max_length=200, blank=True, default='')
    rule_fired      = models.CharField(max_length=200, blank=True, default='')
    suggested_status = models.CharField(max_length=10, choices=Status.choices, blank=True, default='')
    content  = models.JSONField(default=dict)
    snapshot = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-as_of', '-id']

    def __str__(self):
        return f'{self.project_id} · {self.as_of:%Y-%m-%d} · {self.status}'


class Baseline(models.Model):
    """The plan, frozen. Slip on a status report is measured against the project's active baseline.

    ``events`` maps event id (as a string) to that event's title, track, dates and milestone flag
    at the moment of freezing. Events created later have no entry: they are "added since baseline".
    One baseline per project is active; taking a new one retires the others but keeps them.
    """
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='baselines')
    name = models.CharField(max_length=80)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
                                   related_name='baselines')
    created_at = models.DateTimeField(auto_now_add=True)
    committed_end = models.DateField(null=True, blank=True)   # the project's commitment when frozen
    planned_start = models.DateTimeField(null=True, blank=True)
    planned_end = models.DateTimeField(null=True, blank=True)
    events = models.JSONField(default=dict)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def __str__(self):
        return f'{self.project_id} · {self.name}'
