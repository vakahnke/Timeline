from django.contrib.auth import get_user_model
from rest_framework import serializers

from projects.serializers import UserSerializer

from .models import Category, Event, Task

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

    class Meta:
        model = Event
        fields = ['id', 'title', 'start', 'end', 'category', 'color',
                  'notes', 'percent_complete', 'depends_on']

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
