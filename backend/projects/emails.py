"""Transactional account emails (registration notice + activation notice).

Sending is best-effort: a mail failure must never break registration or an admin
action, so every send is wrapped and logged. The backend is configured by
the ``EMAIL_*`` environment variables via ``MAILERS`` (console in dev, SMTP in prod) — see settings.
"""
import logging

from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)


def _site():
    return getattr(settings, 'SITE_URL', 'http://localhost:5173').rstrip('/')


def _safe_send(subject, message, recipients):
    recipients = [r for r in recipients if r]
    if not recipients:
        return False
    try:
        send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, recipients)
        return True
    except Exception:                       # SMTP down, bad creds, etc. — never fatal.
        logger.exception('Account email failed: %s', subject)
        return False


def notify_admin_new_registration(user):
    """Tell the operator a new account is waiting for approval."""
    to = getattr(settings, 'ACCOUNT_NOTIFY_EMAIL', '')
    subject = f'[{settings.APP_NAME}] New account pending approval: {user.username}'
    message = (
        'A new account has registered and is waiting for your approval.\n\n'
        f'  Username: {user.username}\n'
        f'  Email:    {user.email}\n'
        f'  Joined:   {user.date_joined:%Y-%m-%d %H:%M UTC}\n\n'
        'Review and activate it in the Django admin:\n'
        f'  {_site()}/admin/auth/user/{user.pk}/change/\n\n'
        'Tick "Active" and save, or use the "Approve & notify" action on the Users '
        'list — the person is emailed automatically when their account is activated.\n'
    )
    return _safe_send(subject, message, [to])


def notify_user_account_activated(user):
    """Tell the user their account is approved and ready to sign in."""
    subject = f'Your {settings.APP_NAME} account is ready'
    message = (
        f'Hi {user.username},\n\n'
        f'Your {settings.APP_NAME} account has been approved and is ready to use. '
        'You can sign in now:\n\n'
        f'  {_site()}/login\n\n'
        'Sign in with your email or username and the password you chose at sign-up.\n\n'
        f'— {settings.APP_NAME}\n'
    )
    return _safe_send(subject, message, [user.email])


def send_password_reset_link(user, uid, token):
    """The reset link. Says how long it lasts and that ignoring it changes nothing."""
    from urllib.parse import urlencode
    link = f"{_site()}/reset-password?{urlencode({'uid': uid, 'token': token})}"
    subject = f'Reset your {settings.APP_NAME} password'
    message = (
        f'Hi {user.username},\n\n'
        f'Someone asked to reset the password for your {settings.APP_NAME} account. If that was you, '
        'choose a new password here:\n\n'
        f'  {link}\n\n'
        'The link works once and for one hour. If you did not ask for this, ignore this '
        'message: your password stays as it is.\n\n'
        f'— {settings.APP_NAME}\n'
    )
    return _safe_send(subject, message, [user.email])


def send_password_changed_notice(user):
    """Tell the account owner the password changed, in case it was not them."""
    subject = f'Your {settings.APP_NAME} password was changed'
    message = (
        f'Hi {user.username},\n\n'
        f'The password for your {settings.APP_NAME} account was just changed, and every other session '
        'was signed out.\n\n'
        'If this was you, nothing more is needed. If it was not, reset your password now:\n\n'
        f'  {_site()}/forgot-password\n\n'
        f'— {settings.APP_NAME}\n'
    )
    return _safe_send(subject, message, [user.email])
