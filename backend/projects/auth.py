"""Sign in with email *or* username, with a clear message for accounts that are
still awaiting approval.

The frontend posts the identifier in the JWT serializer's username field; we resolve
it to the real user (by username or email) before the parent serializer authenticates,
so the default ModelBackend keeps working unchanged.
"""
from django.contrib.auth import get_user_model
from django.db.models import Q
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

User = get_user_model()


class EmailOrUsernameTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        identifier = (attrs.get(self.username_field) or '').strip()
        password = attrs.get('password') or ''

        user = None
        if identifier:
            try:
                user = User.objects.get(
                    Q(username__iexact=identifier) | Q(email__iexact=identifier))
            except User.DoesNotExist:
                user = None
            except User.MultipleObjectsReturned:
                # Shouldn't happen (email & username are unique); prefer an exact username.
                user = User.objects.filter(username__iexact=identifier).first()

        # Only reveal "pending approval" to someone who has the correct password, so
        # this doesn't leak which accounts exist to a credential-stuffer.
        if user is not None and not user.is_active and user.check_password(password):
            raise AuthenticationFailed(
                'Your account is awaiting approval. You will get an email when it is '
                'ready to use.',
                code='pending_approval',
            )

        # Authenticate by the real username so the default backend (which keys off the
        # username field) succeeds even when the user typed their email.
        if user is not None:
            attrs[self.username_field] = user.get_username()
        return super().validate(attrs)


class EmailOrUsernameTokenObtainPairView(TokenObtainPairView):
    serializer_class = EmailOrUsernameTokenObtainPairSerializer
