# Password Reset by Email — Design Document

**Status:** Building — Phase 1 (reset by email) shipped 2026-09-19. Phase 2 (signed-in change password) not started.
**Last updated:** 2026-09-19
**Scope:** A "Forgot your password?" flow on the sign-in page: request a link by email, set a new password. Two new API endpoints, two small pages, one email. No data-model change.

---

## 0. Problem / motivating requirements

On 2026-09-19 the owner was briefly locked out of production after signing out. The cause turned
out to be a mistyped username, but the investigation exposed a real gap: **there is no way back
into an account without a shell on the server.** A team member who forgets a password today has
to ask the operator, who has to run a Django command on the box.

- **R1.** Anyone with an account can set a new password using only their email inbox.
- **R2.** The flow never reveals whether an email address has an account.
- **R3.** A reset link works once, expires quickly, and dies the moment the password changes.
- **R4.** Resetting a password signs out every other session for that account.
- **R5.** It cannot be used to hammer someone's inbox or to guess tokens.
- **R6.** A signed-in user can also change their own password (there is no screen for that either).

Not in scope: two-factor authentication, single sign-on, "magic link" sign-in, admin-forced resets.

## 1. Current state (grounding)

- **Auth is JWT** (SimpleJWT) with the token blacklist app installed; sign-out blacklists the
  refresh token (`/api/auth/logout/`). Sign-in accepts a username **or** an email
  (`backend/projects/auth.py`). Emails are unique across accounts (checked on prod: no duplicates,
  none empty), so an email identifies one account.
- **Email already works in production.** `backend/projects/emails.py` sends account notices
  through `MAILERS` (Gmail SMTP on prod, console in dev) with a `_safe_send` wrapper that logs
  failures and never raises. `SITE_URL` exists for building links back to the app.
- **Accounts can be inactive** (`REQUIRE_ACCOUNT_APPROVAL`): a new registration waits for the
  operator. A reset must not become a way around approval.
- **Django ships the hard part.** `django.contrib.auth.tokens.PasswordResetTokenGenerator` makes
  a signed token from the user's id, password hash, last-login time and a timestamp. It needs no
  database table, expires after `PASSWORD_RESET_TIMEOUT`, and becomes invalid as soon as the
  password changes (R3) because the hash is part of what is signed.
- **Password rules exist** (`AUTH_PASSWORD_VALIDATORS` in settings) and are already applied at
  registration via `validate_password`.
- **The sign-in page** (`frontend/src/pages/LoginPage.jsx`) has no link for this. The app is a
  single-page app, so Django's built-in HTML reset views do not fit; the API needs JSON endpoints.
- There is **no throttling anywhere** in the API today (`DEFAULT_THROTTLE_CLASSES` is unset).

## 2. Prior art / research

- **OWASP Forgot Password Cheat Sheet** is the reference: identical response and similar timing
  whether or not the account exists; single-use, short-lived, unguessable tokens; do not sign the
  user in automatically after a reset; notify the account owner; rate-limit by account and by IP.
- **Django's own flow** follows that guidance and its token generator is the piece worth reusing.
  Libraries that wrap it for APIs (`dj-rest-auth`, `django-rest-passwordreset`) add a dependency
  and, in the second case, a token table, for about sixty lines of code we can own.
- **Link lifetime.** Django's default is three days. Most products use 15 to 60 minutes; GitHub
  and Google use about an hour.

## 3. Proposed design

- **Data model.** None.
- **API.**
  - `POST /api/auth/password-reset/` `{ "email": "…" }` → always `200 {"detail": "If that address
    has an account, a reset link is on its way."}`. If an **active** account has that email, send
    the message. Inactive (unapproved) accounts get nothing (R2 still holds: same response).
    Throttled: 5 per hour per IP and 3 per hour per target email.
  - `POST /api/auth/password-reset/confirm/` `{ "uid", "token", "new_password" }` → checks the
    token, runs the password validators, sets the password, **blacklists every outstanding refresh
    token for that user** (R4), and emails a "your password was changed" notice. Returns `200`;
    the user then signs in normally. A bad or expired token is a `400` with one generic message.
    Throttled: 10 per hour per IP.
  - `POST /api/auth/password-change/` `{ "current_password", "new_password" }` for a signed-in
    user (R6); same validators, same sign-out of other sessions.
  - `PASSWORD_RESET_TIMEOUT = 3600` (one hour).
- **Email.** Plain text, through the existing `_safe_send`. Says who it is for, that the link
  works once and for one hour, and that nothing changes if they ignore it. The link is
  `SITE_URL/reset-password?uid=…&token=…`.
- **UI / UX.** "Forgot your password?" under the sign-in form → a page with one email field and
  the same confirmation message whatever was typed. The emailed link opens a page with a new
  password field (with the rules shown, and a show/hide toggle), then returns to sign-in with
  "Password changed. Sign in with your new password." A "Change password" item goes in the account
  menu for R6. (The sign-in form already reads
  "Email or username"; no change is needed there.)
- **Permissions impact.** None; these are account-level, not project-level.

## 4. Alternatives considered

- **Django's built-in HTML views** (`PasswordResetView` and friends). Free, but they render server
  templates on a different look and URL space from the app, and prod routes `/` to the SPA.
- **A reset-token table with one-time rows.** Explicitly single-use and easy to audit, but the
  signed-token approach is already single-use in practice (it dies when the password changes)
  and needs no migration or cleanup job.
- **Operator-only resets from the admin.** That is today's situation and the reason for this doc.
- **Magic-link sign-in instead of passwords.** Removes the problem entirely, but changes how
  everyone signs in. Too large a change for this need.

## 5. Phasing

- **Phase 1: SHIPPED.** As built (`backend/projects/password_reset.py`, `ForgotPasswordPage.jsx`,
  `ResetPasswordPage.jsx`), with the proposed answers to the open questions: one-hour links,
  inactive accounts cannot reset, throttling on these endpoints only, and the link is left
  visible on the demo (where mail only prints to the log).
  - The confirm endpoint also accepts a call with no password, which only checks the link, so
    the page can say "expired" immediately instead of after the user has typed a new password.
  - Mail is sent off the request thread so the response takes the same time with or without an
    account. The per-caller throttle keys on `CF-Connecting-IP` when present, because prod sits
    behind Cloudflare. Throttle counters are per process, so the ceiling is up to N times the
    configured rate with N gunicorn workers.
  - The reset page removes the token from the address bar on load and sets
    `Referrer-Policy: no-referrer` through a meta tag.
  - A successful reset emails a "your password was changed" notice (moved up from phase 2).
  - Verified by 11 backend tests and a 13-check browser test that reads the link from the dev
    console mailer (decoding quoted-printable the way a mail client does) and completes the flow.
    **Not yet done:** receiving a real reset email from production in a real inbox.
  Original scope: request + confirm endpoints, the email, the two pages, throttling on those
  endpoints. Tests for: identical responses for known and unknown
  emails, inactive accounts get no mail, token single-use and expiry, validators enforced, other
  sessions signed out, throttles. A browser test reads the link from the dev console mailer and
  completes the flow.
- **Phase 2:** signed-in "Change password" (R6) and the "password was changed" notice everywhere.
- **Later / maybe:** general API throttling; sign-in attempt lockout; two-factor authentication.

## 6. Cost & risk

- **Effort:** Phase 1 **S–M**. Phase 2 **S**.
- **Migration / data risk:** none (no schema change).
- **Security risk:** this is an authentication feature, so mistakes matter. The main ones are
  account enumeration (answered by identical responses), token leakage through the `Referer`
  header or logs (the reset page sets `Referrer-Policy: no-referrer` and the token is never
  logged), and email as a single point of trust (inherent to every email reset).
- **Operational risk:** depends on outbound email. Prod's Gmail SMTP sign-in was verified on
  2026-09-19; the public demo has no mail configured, so the flow there only prints to the log.
- **Blast radius:** new endpoints and pages. Existing sign-in is untouched.

## 7. Open questions / decisions needed

- [ ] **Link lifetime:** one hour (proposed) or longer for people who check email rarely?
- [ ] **Should a reset also re-activate nothing?** Proposed: inactive accounts cannot reset, so
      approval cannot be bypassed.
- [ ] **General API throttling now or later?** Proposed later, but sign-in itself is unthrottled today.
- [ ] **Demo:** hide the link on the public demo (no mail there), or leave it and let it no-op?
