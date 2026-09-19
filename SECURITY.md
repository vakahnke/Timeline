# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private vulnerability reporting instead: go to the **Security** tab
of this repository and click **Report a vulnerability**. That opens a private
thread that only the maintainer can see.

Include what you found, how to reproduce it, and what you think the impact is.
A proof of concept is welcome but not required.

You can expect an acknowledgement within a few days. Fixes are released as
ordinary commits on `main`; if the issue is serious, the advisory will be
published through GitHub once a fix is available.

## Scope

Timeline is self-hosted. The things most worth reporting are:

- Any way for a user to read or change a project they are not a member of.
- Authentication or token-handling flaws in the JWT flow.
- Injection in the API or the Django admin.
- Problems in the production Docker or nginx configuration that expose more
  than intended.

Vulnerabilities in third-party dependencies should go to those projects, but a
note here is still useful if Timeline's usage makes the issue exploitable.

## Supported versions

Only the current `main` branch receives fixes.

## How dependencies are kept current

Dependabot alerts, Dependabot security updates, secret scanning and push protection are enabled
on this repository, and `.github/dependabot.yml` opens routine update pull requests. Before a
release the Python packages are checked with `pip-audit` and the frontend with `npm audit`; both
were clean as of 2026-09-19.
