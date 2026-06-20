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
