from rest_framework import serializers
from .models import Category, Event


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model  = Category
        fields = ['id', 'name', 'color']


class EventSerializer(serializers.ModelSerializer):
    depends_on = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Event.objects.all(),
        required=False,
    )

    class Meta:
        model = Event
        fields = ['id', 'title', 'start', 'end', 'category', 'color', 'notes', 'percent_complete', 'depends_on']

    def validate(self, data):
        start = data.get('start', getattr(self.instance, 'start', None))
        end   = data.get('end',   getattr(self.instance, 'end',   None))
        if start and end and end <= start:
            raise serializers.ValidationError('end must be after start.')
        return data

    def create(self, validated_data):
        depends_on = validated_data.pop('depends_on', [])
        instance = super().create(validated_data)
        instance.depends_on.set(depends_on)
        return instance

    def update(self, instance, validated_data):
        depends_on = validated_data.pop('depends_on', None)
        instance = super().update(instance, validated_data)
        if depends_on is not None:
            instance.depends_on.set(depends_on)
        return instance
