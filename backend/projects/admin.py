from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .emails import notify_user_account_activated
from .models import Project, ProjectMembership, ProjectTemplate, Team

User = get_user_model()

# Replace the stock User admin with one built around account approval: pending accounts
# are easy to find (filter/sort), activating one emails the person automatically.
admin.site.unregister(User)


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    list_display = ['username', 'email', 'is_active', 'is_staff', 'date_joined', 'last_login']
    list_filter  = ['is_active', 'is_staff', 'is_superuser', 'date_joined']
    ordering     = ['-date_joined']      # newest sign-ups (those awaiting approval) on top
    actions      = ['approve_and_notify']

    @admin.action(description='Approve & notify selected users (activate + email them)')
    def approve_and_notify(self, request, queryset):
        count = 0
        for user in queryset.filter(is_active=False):
            user.is_active = True
            user.save(update_fields=['is_active'])
            notify_user_account_activated(user)
            count += 1
        self.message_user(request, f'Approved and emailed {count} user(s).')

    def save_model(self, request, obj, form, change):
        # Activating an account from the change form (ticking "Active") also emails them.
        newly_active = change and 'is_active' in form.changed_data and obj.is_active
        super().save_model(request, obj, form, change)
        if newly_active and notify_user_account_activated(obj):
            self.message_user(request, f'Activation email sent to {obj.email or obj.username}.')


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


@admin.register(ProjectTemplate)
class ProjectTemplateAdmin(admin.ModelAdmin):
    list_display  = ['name', 'owner', 'created_at']
    search_fields = ['name', 'owner__username']


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display       = ['name', 'owner', 'created_at']
    search_fields      = ['name', 'owner__username']
    filter_horizontal  = ['members']
