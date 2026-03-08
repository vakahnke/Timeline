from django.db import models


class Category(models.Model):
    name  = models.CharField(max_length=100, unique=True)
    color = models.CharField(max_length=7, blank=True, default='')

    def __str__(self):
        return self.name


class Event(models.Model):
    title = models.CharField(max_length=200)
    start = models.DateTimeField()
    end   = models.DateTimeField()
    category = models.CharField(max_length=100, default='Default')
    color = models.CharField(max_length=7, blank=True, default='')  # hex e.g. #4a88ff
    notes             = models.TextField(blank=True, default='')
    percent_complete  = models.PositiveSmallIntegerField(default=0)
    depends_on = models.ManyToManyField('self', symmetrical=False, blank=True, related_name='dependents')

    class Meta:
        ordering = ['start']

    def __str__(self):
        return f'{self.title} ({self.category})'
