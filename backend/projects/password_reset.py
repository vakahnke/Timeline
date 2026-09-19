"""Password reset by email (docs/design/password-reset.md).

Two JSON endpoints for the single-page app:

* ``POST /api/auth/password-reset/``          ask for a link
* ``POST /api/auth/password-reset/confirm/``  set a new password with the emailed link

Rules that matter, all from the OWASP forgot-password guidance:

* The request endpoint answers identically whether or not the address has an account, and the
  email is sent off the request thread so the timing does not give it away either.
* Tokens come from Django's ``PasswordResetTokenGenerator``: signed, no database table, valid for
  ``PASSWORD_RESET_TIMEOUT`` and dead the moment the password (or last login) changes, which makes
  a link single-use in practice.
* Inactive accounts (awaiting approval) cannot reset: a reset must not bypass approval.
* A successful reset signs out every other session and does NOT sign the caller in.
* Both endpoints are throttled, per caller and, for requests, per target address.
"""
import hashlib
import sys
import threading

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from .emails import send_password_changed_notice, send_password_reset_link

User = get_user_model()

REQUEST_MESSAGE = 'If that address has an account, a reset link is on its way. It works for one hour.'
BAD_LINK_MESSAGE = 'This reset link is invalid or has expired. Ask for a new one.'


class _CallerThrottle(SimpleRateThrottle):
    """Per caller. Behind Cloudflare the real client address is in CF-Connecting-IP."""

    def get_cache_key(self, request, view):
        ident = request.META.get('HTTP_CF_CONNECTING_IP') or self.get_ident(request)
        return self.cache_format % {'scope': self.scope, 'ident': ident}


class ResetRequestCallerThrottle(_CallerThrottle):
    scope = 'password_reset_request'


class ResetConfirmCallerThrottle(_CallerThrottle):
    scope = 'password_reset_confirm'


class ResetRequestAddressThrottle(SimpleRateThrottle):
    """Per target address, so nobody can use this to flood someone else's inbox."""
    scope = 'password_reset_address'

    def get_cache_key(self, request, view):
        email = str((request.data or {}).get('email') or '').strip().lower()
        if not email:
            return None
        return self.cache_format % {'scope': self.scope, 'ident': hashlib.sha256(email.encode()).hexdigest()}


def _in_background(fn, *args):
    """Send mail off the request thread so response time is the same with or without an account.
    Under ``manage.py test`` it runs inline so tests can read the outbox."""
    if len(sys.argv) > 1 and sys.argv[1] == 'test':
        fn(*args)
        return
    threading.Thread(target=fn, args=args, daemon=True).start()


def sign_out_everywhere(user):
    """Blacklist every refresh token ever issued to this user that is not blacklisted yet."""
    done = set(BlacklistedToken.objects.filter(token__user=user).values_list('token_id', flat=True))
    BlacklistedToken.objects.bulk_create(
        [BlacklistedToken(token=t) for t in OutstandingToken.objects.filter(user=user).exclude(id__in=done)],
        ignore_conflicts=True)


class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ResetRequestCallerThrottle, ResetRequestAddressThrottle]

    @extend_schema(
        summary='Ask for a password reset link',
        description='Always answers 200 with the same message, whether or not the address has an account.',
        request=inline_serializer('PasswordResetRequest', {'email': serializers.EmailField()}),
        responses={200: inline_serializer('PasswordResetRequested', {'detail': serializers.CharField()})},
    )
    def post(self, request):
        email = str(request.data.get('email') or '').strip()
        if email:
            user = User.objects.filter(email__iexact=email, is_active=True).first()
            if user is not None and user.has_usable_password():
                uid = urlsafe_base64_encode(force_bytes(user.pk))
                token = default_token_generator.make_token(user)
                _in_background(send_password_reset_link, user, uid, token)
        return Response({'detail': REQUEST_MESSAGE})


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ResetConfirmCallerThrottle]

    @extend_schema(
        summary='Set a new password with an emailed reset link',
        description=('`uid` and `token` come from the link. On success every other session for the account is '
                     'signed out and the caller signs in normally afterwards. With `new_password` omitted the '
                     'link is only checked, so the page can say at once if it has expired.'),
        request=inline_serializer('PasswordResetConfirm', {
            'uid': serializers.CharField(), 'token': serializers.CharField(),
            'new_password': serializers.CharField(required=False)}),
        responses={200: inline_serializer('PasswordResetDone', {'detail': serializers.CharField()})},
    )
    def post(self, request):
        user = None
        try:
            user = User.objects.get(pk=force_str(urlsafe_base64_decode(str(request.data.get('uid') or ''))), is_active=True)
        except (User.DoesNotExist, ValueError, TypeError, OverflowError, UnicodeDecodeError):
            pass
        if user is None or not default_token_generator.check_token(user, str(request.data.get('token') or '')):
            return Response({'detail': BAD_LINK_MESSAGE, 'code': 'bad_link'}, status=status.HTTP_400_BAD_REQUEST)

        password = request.data.get('new_password')
        if password is None:
            return Response({'detail': 'This link is valid.'})
        try:
            validate_password(str(password), user=user)
        except DjangoValidationError as exc:
            return Response({'new_password': list(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(str(password))
        user.save(update_fields=['password'])          # changing the hash also kills this and any other link
        sign_out_everywhere(user)
        _in_background(send_password_changed_notice, user)
        return Response({'detail': 'Password changed. Sign in with your new password.'})
