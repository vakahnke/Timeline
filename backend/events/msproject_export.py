"""A project as Microsoft Project XML (MSPDI), the interchange format most scheduling tools read.

See docs/design/ms-project-xml.md. Tracks become level-1 summary tasks and events level-2 tasks,
with one finish-to-start link per dependency.

**Keeping the dates.** Microsoft Project recalculates dates when it opens a file. So every task is
written as manually scheduled, and the file carries a 24-hour, 7-day calendar so durations equal
wall-clock time. Project then shows Timeline's dates untouched, with the links drawn, and a
scheduler can switch tasks to automatic scheduling when they choose to take over.

Dates in this format carry no time zone, so the caller says which zone to write them in.

The schema is an xs:sequence: element ORDER is part of the format, and Microsoft Project refuses
a file that gets it wrong. Keep new elements in schema order (mspdi_pj12.xsd on schemas.microsoft.com).
"""
from xml.etree import ElementTree as ET

NS = 'http://schemas.microsoft.com/project'
FINISH_TO_START = '1'
DAYS = '7'                      # DurationFormat / LagFormat: days


def _local(dt, tz):
    return dt.astimezone(tz).replace(tzinfo=None, microsecond=0).isoformat()


def _duration(start, end):
    minutes = max(0, int(round((end - start).total_seconds() / 60)))
    return f'PT{minutes // 60}H{minutes % 60}M0S'


def _clean(text):
    # XML 1.0 forbids most control characters; ElementTree would write them and Project would refuse the file.
    return ''.join(ch for ch in (text or '') if ch in '\t\n\r' or ord(ch) >= 0x20)


def _add(parent, tag, text):
    el = ET.SubElement(parent, tag)
    el.text = _clean(str(text))
    return el


def _task(tasks_el, *, uid, row, name, outline, level, start, end, tz, summary=False, milestone=False,
          percent=0, notes='', predecessors=()):
    t = ET.SubElement(tasks_el, 'Task')
    for tag, val in (('UID', uid), ('ID', row), ('Name', name[:255]), ('Active', 1), ('Manual', 1), ('Type', 1), ('IsNull', 0),
                     ('WBS', outline), ('OutlineNumber', outline), ('OutlineLevel', level), ('Priority', 500),
                     ('Start', _local(start, tz)), ('Finish', _local(end, tz)), ('Duration', _duration(start, end)),
                     ('ManualStart', _local(start, tz)), ('ManualFinish', _local(end, tz)), ('ManualDuration', _duration(start, end)),
                     ('DurationFormat', DAYS), ('Milestone', int(milestone)), ('Summary', int(summary)),
                     ('PercentComplete', max(0, min(100, int(percent)))), ('ConstraintType', 0), ('CalendarUID', -1)):
        _add(t, tag, val)
    if notes:
        _add(t, 'Notes', notes)
    for p in predecessors:
        link = ET.SubElement(t, 'PredecessorLink')
        for tag, val in (('PredecessorUID', p), ('Type', FINISH_TO_START), ('CrossProject', 0), ('LinkLag', 0), ('LagFormat', DAYS)):
            _add(link, tag, val)
    return t


def build_mspdi(project, events, *, tz, now):
    """Return the XML file as bytes. ``events`` must have ``depends_on`` and ``tasks`` prefetched."""
    events = sorted(events, key=lambda e: (e.start, e.id))
    ET.register_namespace('', NS)
    root = ET.Element('Project', {'xmlns': NS})
    start = min((e.start for e in events), default=now)
    end = max((e.end for e in events), default=now)
    for tag, val in (('SaveVersion', 14), ('Name', project.name), ('Title', project.name), ('CreationDate', _local(now, tz)),
                     ('ScheduleFromStart', 1), ('StartDate', _local(start, tz)), ('FinishDate', _local(end, tz)),
                     ('CurrencyCode', 'USD'),                    # required by the schema; Timeline has no costs
                     ('CalendarUID', 1), ('DefaultStartTime', '00:00:00'), ('DefaultFinishTime', '00:00:00'),
                     ('MinutesPerDay', 1440), ('MinutesPerWeek', 10080), ('DaysPerMonth', 30),
                     ('NewTasksAreManual', 1)):
        _add(root, tag, val)

    cals = ET.SubElement(root, 'Calendars')
    cal = ET.SubElement(cals, 'Calendar')
    for tag, val in (('UID', 1), ('Name', '24 Hours'), ('IsBaseCalendar', 1), ('BaseCalendarUID', -1)):
        _add(cal, tag, val)
    week = ET.SubElement(cal, 'WeekDays')
    for day in range(1, 8):
        wd = ET.SubElement(week, 'WeekDay')
        _add(wd, 'DayType', day)
        _add(wd, 'DayWorking', 1)
        wt = ET.SubElement(ET.SubElement(wd, 'WorkingTimes'), 'WorkingTime')
        _add(wt, 'FromTime', '00:00:00')
        _add(wt, 'ToTime', '00:00:00')

    tasks_el = ET.SubElement(root, 'Tasks')
    _task(tasks_el, uid=0, row=0, name=project.name, outline='0', level=0, start=start, end=end, tz=tz, summary=True)

    tracks = []                                   # in order of first appearance, as the timeline draws them
    for e in events:
        if e.category not in tracks:
            tracks.append(e.category)
    # Event UIDs are the event ids, so a link survives whatever order rows are written in; track
    # summaries take ids above every event's.
    next_uid = max((e.id for e in events), default=0) + 1
    row = 0
    for ti, track in enumerate(tracks, start=1):
        mine = [e for e in events if e.category == track]
        row += 1
        _task(tasks_el, uid=next_uid, row=row, name=track, outline=str(ti), level=1, summary=True, tz=tz,
              start=min(e.start for e in mine), end=max(e.end for e in mine),
              percent=round(sum(e.percent_complete for e in mine) / len(mine)))
        next_uid += 1
        for ei, e in enumerate(mine, start=1):
            row += 1
            todo = list(e.tasks.all())
            notes = e.notes.strip()
            if todo:
                notes = (notes + '\n\n' if notes else '') + 'Tasks:\n' + '\n'.join(
                    f"[{'x' if t.status == 'done' else ' '}] {t.title}" for t in todo)
            _task(tasks_el, uid=e.id, row=row, name=e.title, outline=f'{ti}.{ei}', level=2, start=e.start, end=e.end, tz=tz,
                  milestone=e.is_milestone, percent=e.percent_complete, notes=notes,
                  predecessors=sorted(d.id for d in e.depends_on.all()))
    return b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + ET.tostring(root, encoding='utf-8')
