from django.contrib import admin
from .models import Event


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display  = ['title', 'category', 'start', 'end', 'color']
    list_filter   = ['category']
    search_fields = ['title', 'category']
    ordering      = ['start']
