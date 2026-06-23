from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import Project, ProjectMembership, Role, Team
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
        fields = ['id', 'name', 'description', 'owner', 'my_role', 'member_count',
                  'start', 'end', 'progress', 'event_count', 'created_at', 'updated_at']
        read_only_fields = ['id', 'owner', 'my_role', 'member_count', 'start', 'end',
                            'progress', 'event_count', 'created_at', 'updated_at']

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

    class Meta:
        model  = Team
        fields = ['id', 'name', 'description', 'members', 'member_count', 'created_at']
        read_only_fields = ['id', 'members', 'member_count', 'created_at']

    @extend_schema_field(serializers.IntegerField())
    def get_member_count(self, obj):
        return len(obj.members.all())  # uses the prefetch cache


class IdentifierSerializer(serializers.Serializer):
    identifier = serializers.CharField(help_text='Email or username of an existing user.')


class AddTeamToProjectSerializer(serializers.Serializer):
    team = serializers.IntegerField(help_text='Id of one of your teams.')
    role = serializers.ChoiceField(choices=Role.choices, default=Role.EDITOR)


class AddTeamResultSerializer(serializers.Serializer):
    added   = serializers.IntegerField()
    members = ProjectMembershipSerializer(many=True)
