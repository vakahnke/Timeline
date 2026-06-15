from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import Project, ProjectMembership, Role

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email']
        read_only_fields = fields


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])
    email    = serializers.EmailField(required=True)

    class Meta:
        model  = User
        fields = ['id', 'username', 'email', 'password']

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('A user with this email already exists.')
        return value

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError('A user with this username already exists.')
        return value

    def create(self, validated_data):
        return User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
        )


class ProjectMembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model  = ProjectMembership
        fields = ['id', 'user', 'role', 'joined_at']
        read_only_fields = ['id', 'user', 'joined_at']


class ProjectSerializer(serializers.ModelSerializer):
    my_role      = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()

    class Meta:
        model  = Project
        fields = ['id', 'name', 'description', 'owner', 'my_role',
                  'member_count', 'created_at', 'updated_at']
        read_only_fields = ['id', 'owner', 'my_role', 'member_count',
                            'created_at', 'updated_at']

    @extend_schema_field(serializers.IntegerField())
    def get_member_count(self, obj):
        # len() of the prefetched memberships — avoids an N+1 COUNT query per project.
        return len(obj.memberships.all())

    @extend_schema_field(serializers.ChoiceField(choices=Role.choices, allow_null=True))
    def get_my_role(self, obj):
        request = self.context.get('request')
        if not request:
            return None
        user = request.user
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
