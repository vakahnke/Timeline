from django.contrib.auth import get_user_model
from rest_framework import serializers

from projects.serializers import UserSerializer

from .models import Baseline, Category, Comment, Event, StatusReport, Task

User = get_user_model()


def _resolve_user(identifier):
    """Find an existing user by email or username (case-insensitive)."""
    identifier = (identifier or '').strip()
    if not identifier:
        return None
    return (User.objects.filter(email__iexact=identifier).first()
            or User.objects.filter(username__iexact=identifier).first())


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model  = Category
        fields = ['id', 'name', 'color']  # project injected from context, never the client

    def validate_name(self, value):
        project = self.context['project']
        qs = Category.objects.filter(project=project, name=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('A category with this name already exists in this project.')
        return value

    def create(self, validated_data):
        validated_data['project'] = self.context['project']
        return super().create(validated_data)


class EventSerializer(serializers.ModelSerializer):
    depends_on = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Event.objects.none(),  # scoped to the project in __init__
        required=False,
    )
    # Read-only task rollup. The list/detail querysets annotate these (no N+1); on a
    # freshly created/updated instance the annotation is absent, so fall back to a count.
    task_count = serializers.SerializerMethodField()
    tasks_done = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = ['id', 'title', 'start', 'end', 'category', 'color',
                  'notes', 'percent_complete', 'is_milestone', 'depends_on', 'task_count', 'tasks_done']

    def get_task_count(self, obj):
        val = getattr(obj, 'task_count', None)
        return val if val is not None else obj.tasks.count()

    def get_tasks_done(self, obj):
        val = getattr(obj, 'tasks_done', None)
        return val if val is not None else obj.tasks.filter(status=Task.Status.DONE).count()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        project = self.context.get('project')
        if project is not None:
            # Restrict dependency choices to THIS project -> blocks cross-project leaks.
            self.fields['depends_on'].child_relation.queryset = Event.objects.filter(project=project)

    def validate(self, data):
        start = data.get('start', getattr(self.instance, 'start', None))
        end   = data.get('end',   getattr(self.instance, 'end',   None))
        if start and end and end <= start:
            raise serializers.ValidationError('end must be after start.')
        project = self.context.get('project')
        if project is not None:
            for dep in data.get('depends_on', []):
                if dep.project_id != project.id:
                    raise serializers.ValidationError('Dependencies must belong to the same project.')
        return data

    def create(self, validated_data):
        depends_on = validated_data.pop('depends_on', [])
        validated_data['project'] = self.context['project']
        instance = super().create(validated_data)
        instance.depends_on.set(depends_on)
        return instance

    def update(self, instance, validated_data):
        depends_on = validated_data.pop('depends_on', None)
        validated_data.pop('project', None)  # never reparent via update
        instance = super().update(instance, validated_data)
        if depends_on is not None:
            instance.depends_on.set(depends_on)
        return instance


class TaskSerializer(serializers.ModelSerializer):
    """Tasks inside an event. Owner/assignee are read as nested users and written by
    identifier (email or username). Assignee defaults to the owner; owner defaults to
    the current user on create."""
    owner    = UserSerializer(read_only=True)
    assignee = UserSerializer(read_only=True)
    owner_identifier    = serializers.CharField(write_only=True, required=False, allow_blank=True)
    assignee_identifier = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model  = Task
        fields = ['id', 'title', 'status', 'due_date', 'order',
                  'owner', 'assignee', 'owner_identifier', 'assignee_identifier',
                  'created_at']
        read_only_fields = ['id', 'owner', 'assignee', 'created_at']

    def validate(self, data):
        owner_id    = data.pop('owner_identifier', None)
        assignee_id = data.pop('assignee_identifier', None)

        if owner_id:
            owner = _resolve_user(owner_id)
            if not owner:
                raise serializers.ValidationError(
                    {'owner_identifier': 'No user found with that email or username.'})
            data['owner'] = owner
        elif self.instance is None:
            # Default the owner to whoever is creating the task.
            data['owner'] = self.context['request'].user

        if assignee_id:
            assignee = _resolve_user(assignee_id)
            if not assignee:
                raise serializers.ValidationError(
                    {'assignee_identifier': 'No user found with that email or username.'})
            data['assignee'] = assignee
        elif self.instance is None:
            # Default: the task is assigned for action to its owner.
            data['assignee'] = data['owner']

        return data

    def create(self, validated_data):
        validated_data['event'] = self.context['event']
        return super().create(validated_data)


class CommentSerializer(serializers.ModelSerializer):
    """A comment on an event. Author is the current user (set on create); body is required."""
    author = UserSerializer(read_only=True)

    class Meta:
        model  = Comment
        fields = ['id', 'author', 'body', 'created_at', 'updated_at']
        read_only_fields = ['id', 'author', 'created_at', 'updated_at']

    def validate_body(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Comment cannot be empty.')
        return value

    def create(self, validated_data):
        validated_data['event']  = self.context['event']
        validated_data['author'] = self.context['request'].user
        return super().create(validated_data)


class MyTaskSerializer(serializers.ModelSerializer):
    """Read-only view of a task with its event/project context, for the 'my tasks'
    dashboard list."""
    owner    = UserSerializer(read_only=True)
    assignee = UserSerializer(read_only=True)
    event    = serializers.SerializerMethodField()
    project  = serializers.SerializerMethodField()

    class Meta:
        model  = Task
        fields = ['id', 'title', 'status', 'due_date', 'owner', 'assignee',
                  'event', 'project']

    @staticmethod
    def get_event(obj):
        # start/end let the dashboard attribute each task's event duration to its assignee.
        return {'id': obj.event_id, 'title': obj.event.title,
                'start': obj.event.start, 'end': obj.event.end}

    @staticmethod
    def get_project(obj):
        return {'id': obj.event.project_id, 'name': obj.event.project.name}


# A report page is small; this bounds what a client can store in the two JSON columns.
_MAX_JSON_CHARS = 200_000


class StatusReportSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = StatusReport
        fields = ['id', 'as_of', 'layout', 'status', 'status_source', 'override_reason',
                  'rule_fired', 'suggested_status', 'content', 'snapshot',
                  'author', 'author_name', 'created_at', 'updated_at']
        read_only_fields = ['id', 'author', 'author_name', 'created_at', 'updated_at']

    def get_author_name(self, obj) -> str | None:
        return obj.author.username if obj.author_id else None

    def _bounded(self, value, name):
        import json
        if not isinstance(value, dict):
            raise serializers.ValidationError(f'{name} must be an object.')
        if len(json.dumps(value)) > _MAX_JSON_CHARS:
            raise serializers.ValidationError(f'{name} is too large.')
        return value

    def validate_content(self, value):
        return self._bounded(value, 'content')

    def validate_snapshot(self, value):
        return self._bounded(value, 'snapshot')

    def validate(self, data):
        source = data.get('status_source', getattr(self.instance, 'status_source', StatusReport.Source.RULE))
        reason = data.get('override_reason', getattr(self.instance, 'override_reason', ''))
        if source == StatusReport.Source.OVERRIDE and not reason.strip():
            raise serializers.ValidationError({'override_reason': 'Say why the status differs from the rule.'})
        return data

    def create(self, validated_data):
        validated_data['project'] = self.context['project']
        validated_data['author'] = self.context['request'].user
        return super().create(validated_data)


class StatusReportListSerializer(serializers.ModelSerializer):
    """The saved-reports list: light, without the two JSON bodies."""
    author_name = serializers.SerializerMethodField()
    headline = serializers.SerializerMethodField()

    class Meta:
        model = StatusReport
        fields = ['id', 'as_of', 'layout', 'status', 'status_source', 'author_name', 'headline', 'updated_at']

    def get_author_name(self, obj) -> str | None:
        return obj.author.username if obj.author_id else None

    def get_headline(self, obj) -> str:
        return (obj.content or {}).get('headline', '')


class StatusReportExportSerializer(serializers.Serializer):
    """What the print tool has on screen, sent as-is so the exported file matches it (saved or not)."""
    layout = serializers.ChoiceField(choices=StatusReport.Layout.choices, default=StatusReport.Layout.SLIDE)
    paper = serializers.ChoiceField(choices=[('letter', 'Letter'), ('a4', 'A4')], default='letter')
    status = serializers.ChoiceField(choices=StatusReport.Status.choices)
    status_source = serializers.ChoiceField(choices=StatusReport.Source.choices, default=StatusReport.Source.RULE)
    override_reason = serializers.CharField(max_length=200, allow_blank=True, default='')
    rule_fired = serializers.CharField(max_length=200, allow_blank=True, default='')
    content = serializers.JSONField()
    snapshot = serializers.JSONField()
    previous = serializers.JSONField(required=False, allow_null=True, default=None)
    tz_offset = serializers.IntegerField(min_value=-840, max_value=840, default=0)

    def _bounded_dict(self, value, name):
        import json
        if not isinstance(value, dict):
            raise serializers.ValidationError(f'{name} must be an object.')
        if len(json.dumps(value)) > _MAX_JSON_CHARS:
            raise serializers.ValidationError(f'{name} is too large.')
        return value

    def validate_content(self, value):
        return self._bounded_dict(value, 'content')

    def validate_snapshot(self, value):
        value = self._bounded_dict(value, 'snapshot')
        if 'as_of' not in value:
            raise serializers.ValidationError('snapshot is missing as_of.')
        return value

    def validate_previous(self, value):
        if value is not None and not isinstance(value, dict):
            raise serializers.ValidationError('previous must be an object or null.')
        return value


class BaselineSerializer(serializers.ModelSerializer):
    """A frozen plan. Creating one snapshots the schedule as it stands; only the name is accepted."""
    created_by_name = serializers.SerializerMethodField()
    event_count = serializers.SerializerMethodField()

    class Meta:
        model = Baseline
        fields = ['id', 'name', 'active', 'committed_end', 'planned_start', 'planned_end',
                  'event_count', 'created_by_name', 'created_at']
        read_only_fields = ['id', 'active', 'committed_end', 'planned_start', 'planned_end',
                            'event_count', 'created_by_name', 'created_at']

    def get_created_by_name(self, obj) -> str | None:
        return obj.created_by.username if obj.created_by_id else None

    def get_event_count(self, obj) -> int:
        return len(obj.events or {})

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Give the baseline a name.')
        return value
