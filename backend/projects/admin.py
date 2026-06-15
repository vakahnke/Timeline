from django.contrib import admin

from .models import Project, ProjectMembership


class ProjectMembershipInline(admin.TabularInline):
    model = ProjectMembership
    extra = 0
    autocomplete_fields = ['user']


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display  = ['name', 'owner', 'created_at']
    search_fields = ['name', 'owner__username']
    inlines       = [ProjectMembershipInline]


@admin.register(ProjectMembership)
class ProjectMembershipAdmin(admin.ModelAdmin):
    list_display  = ['user', 'project', 'role', 'joined_at']
    list_filter   = ['role']
    search_fields = ['user__username', 'project__name']
