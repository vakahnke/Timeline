"""A project's events as an iCalendar file (RFC 5545) for Outlook, Google and Apple Calendar.

See docs/design/icalendar-export.md. The choices that matter:

* ``UID`` is stable for the life of an event, so importing a newer file updates the same
  calendar entries instead of duplicating them.
* Times are written in UTC (``...Z``). Every client shows them in the viewer's own zone, and no
  VTIMEZONE block is needed.
* ``TRANSP:TRANSPARENT``: a six-week phase must not mark anyone as busy for six weeks.
* Progress goes in the description; PERCENT-COMPLETE is only valid on VTODO.
* Line folding at 75 octets and text escaping are left to the ``icalendar`` library: they are
  exactly what hand-written exporters get wrong, silently.
"""
from datetime import timedelta, timezone as dt_tz

from django.utils import timezone
from icalendar import Calendar, Event as VEvent

MILESTONE_LENGTH = timedelta(hours=1)


def event_uid(event_id, host):
    return f'event-{event_id}@{host}'


def build_ics(project, events, *, host, site_url='', now=None):
    """Return the .ics file as bytes. ``events`` must have ``depends_on`` and ``tasks`` prefetched."""
    now = (now or timezone.now()).astimezone(dt_tz.utc)
    cal = Calendar()
    cal.add('prodid', '-//Timeline//EN')
    cal.add('version', '2.0')
    cal.add('calscale', 'GREGORIAN')
    cal.add('method', 'PUBLISH')
    cal.add('x-wr-calname', project.name)
    link = f"{site_url.rstrip('/')}/projects/{project.id}" if site_url else ''

    for e in events:
        end = e.end.astimezone(dt_tz.utc)
        # A key milestone is a moment, not a span: one hour ending when the work ends.
        start = end - MILESTONE_LENGTH if e.is_milestone else e.start.astimezone(dt_tz.utc)
        tasks = list(e.tasks.all())
        lines = [e.notes.strip()] if e.notes.strip() else []
        lines.append(f'Track: {e.category}')
        lines.append(f'Progress: {e.percent_complete}%')
        if tasks:
            lines.append(f"{sum(1 for t in tasks if t.status == 'done')} of {len(tasks)} tasks done")

        ve = VEvent()
        ve.add('uid', event_uid(e.id, host))
        ve.add('dtstamp', now)
        ve.add('last-modified', now)
        ve.add('dtstart', start)
        ve.add('dtend', end)
        ve.add('summary', f'◆ {e.title}' if e.is_milestone else e.title)
        ve.add('description', '\n'.join(lines))
        ve.add('categories', [e.category])
        ve.add('status', 'CONFIRMED')
        ve.add('transp', 'TRANSPARENT')
        if link:
            ve.add('url', link)
        for dep in e.depends_on.all():
            ve.add('related-to', event_uid(dep.id, host), parameters={'reltype': 'PARENT'})
        cal.add_component(ve)
    return cal.to_ical()
