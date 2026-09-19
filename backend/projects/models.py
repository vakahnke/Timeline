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
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


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
                      "notes", "percent_complete", "depends_on": [task_index, ...]}]
    """
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

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


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
