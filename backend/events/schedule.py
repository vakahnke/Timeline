"""Critical path (CPM) on the server.

A port of the forward/backward pass in ``frontend/src/components/Timeline.jsx`` so that
reports and exports can use the same answer the timeline shows. The two implementations are
kept honest by ``tests_schedule.py``; change one and you must change the other.

Like the client, this works on *durations* (relative time), not calendar positions: an event's
earliest start is the latest finish of its predecessors, regardless of where the bar was
dragged. Dependencies are finish-to-start with no lag.
"""
from collections import deque

TOLERANCE_MS = 60_000   # float at or under one minute counts as critical (matches the client)


def _ms(td):
    return int(td.total_seconds() * 1000)


def critical_path(events):
    """Return ``{'float_ms': {event_id: ms}, 'critical_ids': set, 'order': [ids]}``.

    ``events`` is an iterable of objects with ``id``, ``start``, ``end`` and an iterable
    ``dep_ids`` (predecessor ids). Predecessors outside the set are ignored, as on the client.
    """
    events = list(events)
    if not events:
        return {'float_ms': {}, 'critical_ids': set(), 'order': []}

    by_id = {e.id: e for e in events}
    preds = {e.id: [p for p in e.dep_ids if p in by_id] for e in events}
    successors = {e.id: [] for e in events}
    for eid, ps in preds.items():
        for p in ps:
            successors[p].append(eid)

    # Topological order (Kahn). Anything left over is in a cycle: append it, as the client does.
    in_deg = {eid: len(ps) for eid, ps in preds.items()}
    queue = deque(e.id for e in events if in_deg[e.id] == 0)
    order = []
    while queue:
        eid = queue.popleft()
        order.append(eid)
        for sid in successors[eid]:
            in_deg[sid] -= 1
            if in_deg[sid] == 0:
                queue.append(sid)
    seen = set(order)
    order.extend(e.id for e in events if e.id not in seen)

    dur = {e.id: _ms(e.end - e.start) for e in events}

    es, ef = {}, {}
    for eid in order:
        es[eid] = max((ef.get(p, 0) for p in preds[eid]), default=0)
        ef[eid] = es[eid] + dur[eid]

    project_end = max(ef.values())
    lf, ls = {}, {}
    for eid in reversed(order):
        succs = successors[eid]
        lf[eid] = min((ls.get(s, 0) for s in succs), default=project_end) if succs else project_end
        ls[eid] = lf[eid] - dur[eid]

    float_ms = {eid: ls[eid] - es[eid] for eid in order}
    critical = {eid for eid, f in float_ms.items() if f <= TOLERANCE_MS}
    return {'float_ms': float_ms, 'critical_ids': critical, 'order': order}
