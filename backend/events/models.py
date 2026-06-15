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
