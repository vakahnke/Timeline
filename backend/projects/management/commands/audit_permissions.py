"""Audit effective project access: who can view / edit / manage each project, and why.

    python manage.py audit_permissions           # human-readable, grouped by user
    python manage.py audit_permissions --csv      # CSV to stdout (redirect to a file)

Resolved live via permissions.get_role, so it matches what the app enforces. See
docs/PERMISSIONS.md.
"""
import csv
import io

from django.core.management.base import BaseCommand

from projects.access_report import build_report


class Command(BaseCommand):
    help = 'Report effective project access (view/edit/manage) per user, resolved live.'

    def add_arguments(self, parser):
        parser.add_argument('--csv', action='store_true', help='Emit CSV instead of a text table.')

    def handle(self, *args, **opts):
        rows, no_access = build_report()

        if opts['csv']:
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(['user', 'email', 'project', 'role', 'can_view', 'can_edit', 'can_manage', 'source'])
            for r in rows:
                w.writerow([r['user'], r['email'], r['project'], r['role'],
                            r['can_view'], r['can_edit'], r['can_manage'], ' | '.join(r['sources'])])
            self.stdout.write(buf.getvalue(), ending='')
            return

        self.stdout.write(f"Effective access — {len(rows)} grants")
        cur = None
        for r in rows:
            if r['user'] != cur:
                cur = r['user']
                self.stdout.write('')
                tag = ' [org-admin]' if r['is_admin'] else ''
                self.stdout.write(f"{r['user']}{tag} <{r['email']}>")
            caps = 'view' + ('+edit' if r['can_edit'] else '') + ('+manage' if r['can_manage'] else '')
            self.stdout.write(f"  {r['project']:40.40} {r['role']:7} {caps:16} [{'; '.join(r['sources'])}]")

        if no_access:
            self.stdout.write('')
            self.stdout.write("No access (registered but can't reach any project):")
            for u in no_access:
                self.stdout.write(f"  {u['user']} <{u['email']}>")
