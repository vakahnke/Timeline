from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
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
    members      = ProjectMembershipSerializer(source='memberships', many=True, read_only=True)
    member_count = serializers.IntegerField(source='memberships.count', read_only=True)

    class Meta:
        model  = Project
        fields = ['id', 'name', 'description', 'owner', 'my_role',
                  'member_count', 'members', 'created_at', 'updated_at']
        read_only_fields = ['id', 'owner', 'my_role', 'member_count',
                            'members', 'created_at', 'updated_at']

    def get_my_role(self, obj):
        request = self.context.get('request')
        if not request:
            return None
        user = request.user
        membership = next((m for m in obj.memberships.all() if m.user_id == user.id), None)
        return membership.role if membership else None


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
