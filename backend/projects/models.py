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
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Role(models.TextChoices):
    OWNER  = 'owner',  'Owner'
    EDITOR = 'editor', 'Editor'
    VIEWER = 'viewer', 'Viewer'


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
