from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import (Project, ProjectMembership, ProjectTeam, ProjectTemplate, Role, RunCloseout, Team,
                     TemplateComment, TemplateOwnerNote)
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


class SourceTemplateSerializer(serializers.Serializer):
    key       = serializers.CharField()
    name      = serializers.CharField(allow_null=True, help_text='Null if you can no longer see it.')
    has_owner = serializers.BooleanField(help_text='False for built-ins.')


class ProjectSerializer(serializers.ModelSerializer):
    my_role      = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()
    # Aggregates over the project's events (annotated in ProjectViewSet.get_queryset).
    start        = serializers.SerializerMethodField()
    end          = serializers.SerializerMethodField()
    progress     = serializers.SerializerMethodField()
    event_count  = serializers.SerializerMethodField()
    closeout_state = serializers.SerializerMethodField()
    source_template = serializers.SerializerMethodField()

    class Meta:
        model  = Project
        fields = ['id', 'name', 'description', 'committed_end', 'status_thresholds', 'owner', 'my_role', 'member_count',
                  'start', 'end', 'progress', 'event_count', 'source_template_key', 'count_in_track_record',
                  'closeout_state', 'source_template', 'created_at', 'updated_at']
        read_only_fields = ['id', 'owner', 'my_role', 'member_count', 'start', 'end', 'source_template_key',
                            'closeout_state', 'source_template',
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

    @extend_schema_field(SourceTemplateSerializer(allow_null=True))
    def get_source_template(self, obj):
        """The template this project came from, for the close-out dialog. Only on a single
        project (not the list), and it names the template only if you may still see it."""
        view = self.context.get('view')
        if not obj.source_template_key or getattr(view, 'action', None) != 'retrieve':
            return None
        from . import library
        found = library.resolve(obj.source_template_key, self.context['request'].user)
        return {'key': obj.source_template_key, 'name': found.name if found else None,
                'has_owner': obj.source_template_key.startswith('saved:')
                             and ProjectTemplate.objects.filter(pk=obj.source_template_key.split(':', 1)[1]).exists()}

    @extend_schema_field(serializers.ChoiceField(choices=['none', 'offered', 'dismissed', 'closed']))
    def get_closeout_state(self, obj):
        """closed: answered. dismissed: an owner said "not now". offered: it came from a template
        and every event is done, so the page may offer the close-out. Otherwise none."""
        closed = getattr(obj, 'has_closeout', None)          # annotated by ProjectViewSet
        if closed is None:
            closed = RunCloseout.objects.filter(project=obj).exists()
        if closed:
            return 'closed'
        if obj.closeout_dismissed:
            return 'dismissed'
        count, done = getattr(obj, 'ev_count', None), getattr(obj, 'ev_done', None)
        if count is None or done is None:
            count = obj.events.count()
            done = obj.events.filter(percent_complete__gte=100).count()
        return 'offered' if obj.source_template_key and count and done == count else 'none'

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


CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'INR', 'BRL', 'MXN']


class RunCloseoutSerializer(serializers.ModelSerializer):
    closed_by = serializers.CharField(source='closed_by.username', read_only=True, default=None)
    # From before Lessons learned. Read-only now: an older client that still sends
    # ``lesson_to_owner`` or ``post_as_comment`` is not refused, and nothing happens.
    posted_as_comment = serializers.SerializerMethodField()
    lesson_removed    = serializers.SerializerMethodField()

    @extend_schema_field(serializers.BooleanField())
    def get_posted_as_comment(self, obj):
        return obj.posted_comment_id is not None

    @extend_schema_field(serializers.BooleanField(help_text='Taken down from the template\'s Lessons learned '
                                                            'by its owner or an admin. It stays on the project.'))
    def get_lesson_removed(self, obj):
        return obj.lesson_removed_at is not None

    class Meta:
        model  = RunCloseout
        fields = ['outcome', 'cost_amount', 'cost_currency', 'effort_person_days', 'lesson',
                  'share_figures', 'lesson_public', 'lesson_anonymous', 'lesson_removed',
                  'lesson_to_owner', 'posted_as_comment', 'closed_by', 'closed_at', 'updated_at']
        read_only_fields = ['lesson_removed', 'lesson_to_owner', 'posted_as_comment',
                            'closed_by', 'closed_at', 'updated_at']
        extra_kwargs = {'lesson': {'max_length': 500, 'trim_whitespace': True}}

    def validate_cost_amount(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('A cost cannot be negative.')
        return value

    def validate_effort_person_days(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Effort cannot be negative.')
        return value

    def validate_cost_currency(self, value):
        value = (value or '').strip().upper()
        if value and not (len(value) == 3 and value.isalpha()):
            raise serializers.ValidationError('Use a three-letter currency code, such as USD.')
        return value

    def validate(self, data):
        amount = data.get('cost_amount', getattr(self.instance, 'cost_amount', None))
        currency = data.get('cost_currency', getattr(self.instance, 'cost_currency', ''))
        if amount is not None and not currency:
            data['cost_currency'] = settings.DEFAULT_CURRENCY
        if amount is None:
            data['cost_currency'] = ''
        return data


class TemplateLessonSerializer(serializers.Serializer):
    lesson    = serializers.CharField()
    closed_at = serializers.DateTimeField()
    project   = serializers.CharField(allow_null=True, help_text='Named only if you are on that project.')


class OwnerNoteSerializer(serializers.ModelSerializer):
    text     = serializers.CharField(max_length=300, trim_whitespace=True)
    position = serializers.IntegerField(min_value=0, required=False, write_only=True,
                                        help_text='Where it should sit in the list, from 0.')

    class Meta:
        model  = TemplateOwnerNote
        fields = ['id', 'text', 'position']
        read_only_fields = ['id']


class RunLessonSerializer(serializers.Serializer):
    id      = serializers.UUIDField(help_text='Not a project or close-out id.')
    text    = serializers.CharField()
    outcome = serializers.ChoiceField(choices=RunCloseout.Outcome.choices, allow_blank=True)
    month   = serializers.CharField(help_text='YYYY-MM')
    author  = serializers.CharField(allow_null=True, help_text='Null when signed Anonymous, for every caller.')
    is_mine = serializers.BooleanField()


class LessonsLearnedSerializer(serializers.Serializer):
    notes         = OwnerNoteSerializer(many=True)
    runs          = RunLessonSerializer(many=True)
    total         = serializers.IntegerField()
    can_add_notes = serializers.BooleanField()
    can_remove    = serializers.BooleanField()


class CostTotalsSerializer(serializers.Serializer):
    median   = serializers.FloatField(help_text='Median of shared figures, rounded to two significant figures.')
    currency = serializers.CharField()
    runs     = serializers.IntegerField()


class EffortTotalsSerializer(serializers.Serializer):
    median_days = serializers.FloatField()
    runs        = serializers.IntegerField()


class TrackRecordSerializer(serializers.Serializer):
    started           = serializers.IntegerField()
    finished          = serializers.IntegerField()
    in_flight         = serializers.IntegerField()
    abandoned         = serializers.IntegerField()
    typical_ratio     = serializers.FloatField(allow_null=True, help_text='Median actual/planned length of '
                                               'finished runs; null until enough runs have finished.')
    min_finished_runs = serializers.IntegerField()
    stopped           = serializers.IntegerField(help_text='Closed out as "we stopped early".')
    closed            = serializers.IntegerField(help_text='Runs whose owner closed them out.')
    outcomes          = serializers.DictField(child=serializers.IntegerField(), allow_null=True,
                                              help_text='Counts per answer; null until enough runs are closed out.')
    cost              = CostTotalsSerializer(allow_null=True)
    effort            = EffortTotalsSerializer(allow_null=True)


class TemplateListItemSerializer(serializers.Serializer):
    """Documents the shape built by ``library.describe``. Fields are only ever added."""
    key             = serializers.CharField()
    source          = serializers.ChoiceField(choices=['builtin', 'saved'])
    id              = serializers.IntegerField(required=False)
    name            = serializers.CharField()
    description     = serializers.CharField()
    summary         = serializers.CharField()
    group           = serializers.ChoiceField(choices=ProjectTemplate.Group.choices)
    tags            = serializers.ListField(child=serializers.CharField())
    category_count  = serializers.IntegerField()
    task_count      = serializers.IntegerField()
    milestone_count = serializers.IntegerField()
    span_minutes    = serializers.IntegerField()
    official        = serializers.BooleanField()
    is_mine         = serializers.BooleanField()
    can_edit        = serializers.BooleanField()
    can_delete      = serializers.BooleanField()
    visibility      = serializers.ChoiceField(choices=ProjectTemplate.Visibility.choices)
    author          = serializers.CharField(allow_null=True, help_text='Null when the author chose not to be named.')
    published_at    = serializers.DateTimeField(allow_null=True)
    votes           = serializers.IntegerField()
    voted           = serializers.BooleanField()
    comment_count   = serializers.IntegerField()
    track_record    = TrackRecordSerializer()


class TemplateDetailSerializer(TemplateListItemSerializer):
    categories   = serializers.ListField(child=serializers.DictField())
    tasks        = serializers.ListField(child=serializers.DictField())
    library_mode = serializers.ChoiceField(choices=['instance', 'teams', 'off'])
    lessons_learned = LessonsLearnedSerializer()


def _clean_tags(value):
    seen, out = set(), []
    for raw in value:
        tag = ' '.join(str(raw).split())[:30]
        if tag and tag.lower() not in seen:
            seen.add(tag.lower())
            out.append(tag)
    if len(out) > 8:
        raise serializers.ValidationError('Eight tags at most.')
    return out


class TemplateUpdateSerializer(serializers.Serializer):
    name           = serializers.CharField(max_length=200, required=False)
    description    = serializers.CharField(required=False, allow_blank=True, max_length=5000)
    summary        = serializers.CharField(required=False, allow_blank=True, max_length=200)
    group          = serializers.ChoiceField(choices=ProjectTemplate.Group.choices, required=False)
    tags           = serializers.ListField(child=serializers.CharField(), required=False)
    visibility     = serializers.ChoiceField(choices=ProjectTemplate.Visibility.choices, required=False)
    shared_with_teams = serializers.ListField(child=serializers.IntegerField(), required=False)
    author_display = serializers.ChoiceField(choices=ProjectTemplate.AuthorDisplay.choices, required=False)
    share_notes    = serializers.BooleanField(required=False)
    share_todos    = serializers.BooleanField(required=False)

    def validate_tags(self, value):
        return _clean_tags(value)


class TemplateCommentSerializer(serializers.ModelSerializer):
    author     = serializers.CharField(source='author.username', read_only=True)
    is_mine    = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()
    body       = serializers.CharField(max_length=4000, trim_whitespace=True)

    class Meta:
        model  = TemplateComment
        fields = ['id', 'author', 'body', 'is_mine', 'can_delete', 'created_at', 'updated_at']
        read_only_fields = ['id', 'author', 'is_mine', 'can_delete', 'created_at', 'updated_at']

    def _user(self):
        return self.context['request'].user

    @extend_schema_field(serializers.BooleanField())
    def get_is_mine(self, obj):
        return obj.author_id == self._user().id

    @extend_schema_field(serializers.BooleanField())
    def get_can_delete(self, obj):
        user, template = self._user(), self.context.get('template')
        return obj.author_id == user.id or bool(user.is_staff) or bool(template and template.is_mine)


class TemplateReportSerializer(serializers.Serializer):
    reason  = serializers.CharField(required=False, allow_blank=True, max_length=1000)
    comment = serializers.IntegerField(required=False, help_text='Id of the comment being reported, if any.')
    lesson  = serializers.UUIDField(required=False, help_text='Id of the lesson being reported, if any.')


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
