from django.contrib import admin

from .models import Category, Event


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display  = ['name', 'project', 'color']
    list_filter   = ['project']
    search_fields = ['name', 'project__name']


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display  = ['title', 'project', 'category', 'start', 'end', 'color']
    list_filter   = ['project', 'category']
    search_fields = ['title', 'category', 'project__name']
    ordering      = ['start']
