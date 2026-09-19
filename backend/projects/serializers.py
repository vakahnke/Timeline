from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import Project, ProjectMembership, ProjectTeam, Role, Team
from .permissions import is_org_admin

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email']
        read_only_fields = fields


class MeSerializer(serializers.ModelSerializer):
    """The signed-in user's own profile. Unlike UserSerializer (used for other people, e.g.
    task owner/assignee), this exposes `is_staff` so the UI can show admin-only controls."""
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'is_staff']
        read_only_fields = fields


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])
    email    = serializers.EmailField(required=True)
    # Read-only: tells the frontend whether the new account still needs admin approval.
    is_active = serializers.BooleanField(read_only=True)

    class Meta:
        model  = User
        fields = ['id', 'username', 'email', 'password', 'is_active']
        read_only_fields = ['id', 'is_active']

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('A user with this email already exists.')
        return value

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError('A user with this username already exists.')
        return value

    def create(self, validated_data):
        # New accounts are inactive until an admin approves them, unless approval is
        # explicitly disabled (REQUIRE_ACCOUNT_APPROVAL=0).
        return User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            is_active=not getattr(settings, 'REQUIRE_ACCOUNT_APPROVAL', True),
        )


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField(help_text='The refresh token to revoke (blacklist).')


class ProjectMembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model  = ProjectMembership
        fields = ['id', 'user', 'role', 'joined_at']
        read_only_fields = ['id', 'user', 'joined_at']


class ProjectSerializer(serializers.ModelSerializer):
    my_role      = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()
    # Aggregates over the project's events (annotated in ProjectViewSet.get_queryset).
    start        = serializers.SerializerMethodField()
    end          = serializers.SerializerMethodField()
    progress     = serializers.SerializerMethodField()
    event_count  = serializers.SerializerMethodField()

    class Meta:
        model  = Project
        fields = ['id', 'name', 'description', 'committed_end', 'status_thresholds', 'owner', 'my_role', 'member_count',
                  'start', 'end', 'progress', 'event_count', 'created_at', 'updated_at']
        read_only_fields = ['id', 'owner', 'my_role', 'member_count', 'start', 'end',
                            'progress', 'event_count', 'created_at', 'updated_at']

    def validate_status_thresholds(self, value):
        limits = {'off_track_working_days': (1, 250), 'off_track_percent': (1, 100), 'behind_points': (1, 100)}
        if not isinstance(value, dict):
            raise serializers.ValidationError('Must be an object.')
        clean = {}
        for key, v in value.items():
            if key not in limits:
                raise serializers.ValidationError(f'Unknown threshold "{key}".')
            if v in (None, ''):
                continue                                  # blank = use the default
            lo, hi = limits[key]
            if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
                raise serializers.ValidationError(f'{key} must be a whole number from {lo} to {hi}.')
            clean[key] = v
        return clean

    @extend_schema_field(serializers.IntegerField())
    def get_member_count(self, obj):
        # len() of the prefetched memberships — avoids an N+1 COUNT query per project.
        return len(obj.memberships.all())

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_start(self, obj):
        return getattr(obj, 'ev_start', None)

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_end(self, obj):
        return getattr(obj, 'ev_end', None)

    @extend_schema_field(serializers.IntegerField())
    def get_progress(self, obj):
        p = getattr(obj, 'avg_progress', None)
        return round(p) if p is not None else 0

    @extend_schema_field(serializers.IntegerField())
    def get_event_count(self, obj):
        return getattr(obj, 'ev_count', 0)

    @extend_schema_field(serializers.ChoiceField(choices=Role.choices, allow_null=True))
    def get_my_role(self, obj):
        request = self.context.get('request')
        if not request:
            return None
        user = request.user
        if is_org_admin(user):              # org-admins act as Owner on every project
            return Role.OWNER
        membership = next((m for m in obj.memberships.all() if m.user_id == user.id), None)
        return membership.role if membership else None


class TemplateListItemSerializer(serializers.Serializer):
    key            = serializers.CharField()
    source         = serializers.ChoiceField(choices=['builtin', 'saved'])
    id             = serializers.IntegerField(required=False)
    name           = serializers.CharField()
    description    = serializers.CharField()
    category_count = serializers.IntegerField()
    task_count     = serializers.IntegerField()


class SaveTemplateSerializer(serializers.Serializer):
    project     = serializers.IntegerField(help_text='Id of an existing project to snapshot.')
    name        = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True, default='')


class InstantiateTemplateSerializer(serializers.Serializer):
    key         = serializers.CharField(help_text='Template key, e.g. "builtin:sprint" or "saved:3".')
    start       = serializers.DateTimeField(help_text='When the project starts; tasks are shifted to it.')
    name        = serializers.CharField(max_length=200, required=False, allow_blank=True)
    description = serializers.CharField(required=False, allow_blank=True, default='')
    owner       = serializers.CharField(required=False, allow_blank=True,
                                        help_text='Email/username of the target owner. Defaults to you.')


class AddMemberSerializer(serializers.Serializer):
    identifier = serializers.CharField(help_text='Email or username of an existing user.')
    role       = serializers.ChoiceField(choices=Role.choices, default=Role.VIEWER)

    def validate_identifier(self, value):
        user = (User.objects.filter(email__iexact=value).first()
                or User.objects.filter(username__iexact=value).first())
        if not user:
            raise serializers.ValidationError('No user found with that email or username.')
        self.context['target_user'] = user
        return value


class TeamSerializer(serializers.ModelSerializer):
    members      = UserSerializer(many=True, read_only=True)
    member_count = serializers.SerializerMethodField()
    is_owner     = serializers.SerializerMethodField()
    # How many projects this team is assigned to — so the UI can warn that a roster edit
    # ripples across them (team access is live). See docs/PERMISSIONS.md.
    assigned_project_count = serializers.SerializerMethodField()

    class Meta:
        model  = Team
        fields = ['id', 'name', 'description', 'members', 'member_count', 'is_owner',
                  'assigned_project_count', 'created_at']
        read_only_fields = ['id', 'members', 'member_count', 'is_owner',
                            'assigned_project_count', 'created_at']

    @extend_schema_field(serializers.IntegerField())
    def get_member_count(self, obj):
        return len(obj.members.all())  # uses the prefetch cache

    @extend_schema_field(serializers.IntegerField())
    def get_assigned_project_count(self, obj):
        return obj.project_links.count()

    @extend_schema_field(serializers.BooleanField())
    def get_is_owner(self, obj):
        # Lets the UI show edit controls only to the owner; members get a read-only view.
        request = self.context.get('request')
        return bool(request and obj.owner_id == request.user.id)


class IdentifierSerializer(serializers.Serializer):
    identifier = serializers.CharField(help_text='Email or username of an existing user.')


class AddTeamToProjectSerializer(serializers.Serializer):
    team = serializers.IntegerField(help_text='Id of one of your teams.')
    # Team grants are capped at Editor — ownership is always granted individually/directly
    # so the "last owner" guarantee stays meaningful (see docs/PERMISSIONS.md §3.6).
    role = serializers.ChoiceField(
        choices=[(Role.VIEWER, 'Viewer'), (Role.COMMENTER, 'Commenter'), (Role.EDITOR, 'Editor')],
        default=Role.EDITOR)


class ProjectTeamSerializer(serializers.ModelSerializer):
    """A team assignment on a project: the team (with its members) plus the granted role."""
    team = TeamSerializer(read_only=True)

    class Meta:
        model  = ProjectTeam
        fields = ['id', 'team', 'role', 'added_at']
        read_only_fields = fields


class AddTeamResultSerializer(serializers.Serializer):
    added   = serializers.IntegerField()
    members = ProjectMembershipSerializer(many=True)
