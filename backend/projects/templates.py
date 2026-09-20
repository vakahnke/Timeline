"""Helpers to save a project as a template and to instantiate a project from one."""
from datetime import timedelta

from django.db import transaction

from events.models import Category, Event, Task

from .models import Project, ProjectMembership, Role


def spec_from_project(project):
    """Build a template spec ({categories, tasks}) from an existing project.

    Task offsets are measured from the project's earliest event start, so the
    template can later be anchored to any start datetime.

    A template is the PLAN, not the record of one run. It keeps what makes the plan reusable
    (tracks, events, durations, dependencies, notes, which events are key milestones, and the
    to-do items inside each event) and forgets what belonged to that run: the dates, the progress,
    who did each to-do and whether it got done. A finished project therefore becomes a template
    that starts at zero.
    """
    events = list(project.events.prefetch_related('depends_on', 'tasks').order_by('start'))
    categories = [{'name': c.name, 'color': c.color} for c in project.categories.all()]

    anchor = events[0].start if events else None
    index_by_id = {e.id: i for i, e in enumerate(events)}

    tasks = []
    for e in events:
        tasks.append({
            'title': e.title,
            'category': e.category,
            'start_offset_minutes': int((e.start - anchor).total_seconds() // 60),
            'duration_minutes': max(1, int((e.end - e.start).total_seconds() // 60)),
            'notes': e.notes,
            'is_milestone': e.is_milestone,
            'depends_on': [index_by_id[d.id] for d in e.depends_on.all() if d.id in index_by_id],
            # To-dos travel as titles, with their due date as days from the project's start.
            'todos': [{'title': t.title,
                       'due_offset_days': (t.due_date - anchor.date()).days if t.due_date else None}
                      for t in e.tasks.all()],
        })
    return {'categories': categories, 'tasks': tasks}


@transaction.atomic
def create_project_from_spec(spec, *, name, description, start, owner, also_owner=None, source_key=''):
    """Create a Project (with categories + events) from a template spec.

    `start` anchors task offsets. `owner` becomes the project Owner; if `also_owner`
    is a different user, they are added as a co-Owner so they can manage it too. ``source_key``
    records which template the project came from, and the plan's length at that moment, which is
    what the template's track record is later measured against (library.track_records).
    """
    from .library import span_minutes
    project = Project.objects.create(
        name=name, description=description, owner=owner, source_template_key=source_key,
        source_template_span=(span_minutes(spec.get('tasks', [])) or None) if source_key else None)
    ProjectMembership.objects.create(project=project, user=owner, role=Role.OWNER)
    if also_owner is not None and also_owner.id != owner.id:
        ProjectMembership.objects.get_or_create(
            project=project, user=also_owner, defaults={'role': Role.OWNER})

    color_by_category = {}
    for c in spec.get('categories', []):
        Category.objects.create(project=project, name=c['name'], color=c.get('color', ''))
        color_by_category[c['name']] = c.get('color', '')

    created = []
    for t in spec.get('tasks', []):
        s = start + timedelta(minutes=int(t.get('start_offset_minutes', 0)))
        e = s + timedelta(minutes=max(1, int(t.get('duration_minutes', 60))))
        created.append(Event.objects.create(
            project=project,
            title=t['title'],
            start=s,
            end=e,
            category=t.get('category', 'Default'),
            color=color_by_category.get(t.get('category'), ''),
            notes=t.get('notes', ''),
            # Always a fresh start. Templates saved before this rule still carry the progress of
            # the project they came from; it is ignored, not copied into the new project.
            percent_complete=0,
            is_milestone=bool(t.get('is_milestone', False)),
        ))
        for order, todo in enumerate(t.get('todos') or []):
            title = str(todo.get('title') or '').strip()[:200]
            if not title:
                continue
            offset = todo.get('due_offset_days')
            Task.objects.create(
                event=created[-1], title=title, order=order, owner=owner, assignee=owner,
                due_date=(start + timedelta(days=int(offset))).date() if isinstance(offset, int) else None)

    # Wire dependencies (stored as task indices).
    for t, ev in zip(spec.get('tasks', []), created):
        deps = [created[i].id for i in t.get('depends_on', []) if 0 <= i < len(created)]
        if deps:
            ev.depends_on.set(deps)

    return project
