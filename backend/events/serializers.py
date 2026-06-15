from rest_framework import serializers

from .models import Category, Event


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
