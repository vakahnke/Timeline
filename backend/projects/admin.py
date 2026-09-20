from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.core.exceptions import PermissionDenied
from django.template.response import TemplateResponse

from .access_report import build_report
from .emails import notify_user_account_activated
from .models import (EffectiveAccessReport, HiddenBuiltinTemplate, Project, ProjectMembership,
                     ProjectTeam, ProjectTemplate, Team, TemplateComment, TemplateReport)
from .permissions import is_org_admin

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


class ProjectTeamInline(admin.TabularInline):
    model = ProjectTeam
    extra = 0
    autocomplete_fields = ['team']
    readonly_fields = ['added_by', 'added_at']


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display  = ['name', 'owner', 'created_at']
    search_fields = ['name', 'owner__username']
    inlines       = [ProjectMembershipInline, ProjectTeamInline]


@admin.register(ProjectMembership)
class ProjectMembershipAdmin(admin.ModelAdmin):
    list_display  = ['user', 'project', 'role', 'joined_at']
    list_filter   = ['role']
    search_fields = ['user__username', 'project__name']


@admin.register(ProjectTeam)
class ProjectTeamAdmin(admin.ModelAdmin):
    list_display        = ['team', 'project', 'role', 'added_by', 'added_at']
    list_filter         = ['role']
    search_fields       = ['team__name', 'project__name']
    autocomplete_fields = ['project', 'team']
    readonly_fields     = ['added_by', 'added_at']


@admin.register(EffectiveAccessReport)
class EffectiveAccessAdmin(admin.ModelAdmin):
    """Read-only computed report: who can view / edit / manage each project, and *why*.
    Not a table — it renders the live get_role resolution. Org-admins only."""

    def has_module_permission(self, request):        return is_org_admin(request.user)
    def has_view_permission(self, request, obj=None): return is_org_admin(request.user)
    def has_add_permission(self, request):            return False
    def has_change_permission(self, request, obj=None): return False
    def has_delete_permission(self, request, obj=None): return False

    def changelist_view(self, request, extra_context=None):
        if not is_org_admin(request.user):
            raise PermissionDenied
        rows, no_access = build_report()
        context = {
            **self.admin_site.each_context(request),
            'title': 'Effective access',
            'rows': rows,
            'no_access': no_access,
            'project_count': Project.objects.count(),
            'opts': self.model._meta,
        }
        return TemplateResponse(request, 'admin/effective_access.html', context)


@admin.register(ProjectTemplate)
class ProjectTemplateAdmin(admin.ModelAdmin):
    list_display  = ['name', 'owner', 'visibility', 'published_at', 'created_at']
    list_filter   = ['visibility', 'group']
    search_fields = ['name', 'owner__username']
    filter_horizontal = ['shared_with_teams']


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display       = ['name', 'owner', 'created_at']
    search_fields      = ['name', 'owner__username']
    filter_horizontal  = ['members']


@admin.register(HiddenBuiltinTemplate)
class HiddenBuiltinTemplateAdmin(admin.ModelAdmin):
    # A row here = a retired built-in template. Delete the row to restore the built-in.
    list_display  = ['slug', 'hidden_by', 'created_at']
    search_fields = ['slug']


@admin.register(TemplateReport)
class TemplateReportAdmin(admin.ModelAdmin):
    """Templates and comments that people have flagged. Unpublish the template in the app (or
    set its visibility to Private here), delete the comment below, then tick Resolved."""
    list_display  = ['template_key', 'comment', 'reporter', 'reason', 'resolved', 'created_at']
    list_filter   = ['resolved']
    list_editable = ['resolved']
    readonly_fields = ['reporter', 'template_key', 'comment', 'reason', 'created_at']


@admin.register(TemplateComment)
class TemplateCommentAdmin(admin.ModelAdmin):
    list_display  = ['template_key', 'author', 'body', 'created_at']
    search_fields = ['template_key', 'body', 'author__username']
