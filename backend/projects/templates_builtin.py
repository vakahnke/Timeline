"""
Built-in project templates. Same shape as a saved ProjectTemplate's
`categories` / `tasks` JSON, so instantiation treats both identically.

Task timing is relative: `start_offset_minutes` is measured from the project's
chosen start datetime; `depends_on` holds indices into the task list.
"""

DAY = 1440  # minutes

BUILTIN_TEMPLATES = {
    'sprint': {
        'name': 'Two-Week Sprint',
        'description': 'A standard agile sprint: planning, two build phases, review, QA, and retro.',
        'categories': [
            {'name': 'Planning',    'color': '#818cf8'},
            {'name': 'Engineering', 'color': '#4a88ff'},
            {'name': 'QA',          'color': '#34d399'},
            {'name': 'Review',      'color': '#fbbf24'},
        ],
        'tasks': [
            {'title': 'Sprint Planning',     'category': 'Planning',    'start_offset_minutes': 0,         'duration_minutes': 180, 'notes': 'Scope and commit the sprint backlog.', 'percent_complete': 0, 'depends_on': []},
            {'title': 'Backlog Grooming',    'category': 'Planning',    'start_offset_minutes': 240,       'duration_minutes': 120, 'notes': 'Refine upcoming stories.',            'percent_complete': 0, 'depends_on': [0]},
            {'title': 'Development Phase 1', 'category': 'Engineering', 'start_offset_minutes': 1 * DAY,   'duration_minutes': 480, 'notes': 'First build push.',                   'percent_complete': 0, 'depends_on': [0]},
            {'title': 'Development Phase 2', 'category': 'Engineering', 'start_offset_minutes': 3 * DAY,   'duration_minutes': 480, 'notes': 'Second build push.',                  'percent_complete': 0, 'depends_on': [2]},
            {'title': 'Code Review',         'category': 'Review',      'start_offset_minutes': 5 * DAY,   'duration_minutes': 240, 'notes': 'Review open pull requests.',          'percent_complete': 0, 'depends_on': [3]},
            {'title': 'QA Testing',          'category': 'QA',          'start_offset_minutes': 6 * DAY,   'duration_minutes': 480, 'notes': 'Full regression pass.',               'percent_complete': 0, 'depends_on': [4]},
            {'title': 'Bug Fixes',           'category': 'Engineering', 'start_offset_minutes': 8 * DAY,   'duration_minutes': 480, 'notes': 'Address QA findings.',                'percent_complete': 0, 'depends_on': [5]},
            {'title': 'Sprint Review',       'category': 'Review',      'start_offset_minutes': 9 * DAY,   'duration_minutes': 120, 'notes': 'Demo to stakeholders.',               'percent_complete': 0, 'depends_on': [6]},
            {'title': 'Retrospective',       'category': 'Planning',    'start_offset_minutes': 9 * DAY + 180, 'duration_minutes': 60, 'notes': 'What went well / what to improve.', 'percent_complete': 0, 'depends_on': [7]},
        ],
    },
    'launch': {
        'name': 'Product Launch',
        'description': 'Take a product from kickoff to launch day across strategy, design, engineering, and marketing.',
        'categories': [
            {'name': 'Strategy',    'color': '#c44aff'},
            {'name': 'Design',      'color': '#ff6b4a'},
            {'name': 'Engineering', 'color': '#4a88ff'},
            {'name': 'Marketing',   'color': '#ffd84a'},
            {'name': 'QA',          'color': '#34d399'},
        ],
        'tasks': [
            {'title': 'Kickoff',          'category': 'Strategy',    'start_offset_minutes': 0,          'duration_minutes': 120,      'notes': 'Align on goals and scope.',        'percent_complete': 0, 'depends_on': []},
            {'title': 'Market Research',  'category': 'Strategy',    'start_offset_minutes': 1 * DAY,    'duration_minutes': 480,      'notes': 'Validate the opportunity.',        'percent_complete': 0, 'depends_on': [0]},
            {'title': 'Design Mockups',   'category': 'Design',      'start_offset_minutes': 3 * DAY,    'duration_minutes': 2 * DAY,  'notes': 'High-fidelity mockups.',           'percent_complete': 0, 'depends_on': [0]},
            {'title': 'Build MVP',        'category': 'Engineering', 'start_offset_minutes': 7 * DAY,    'duration_minutes': 5 * DAY,  'notes': 'Implement the core product.',      'percent_complete': 0, 'depends_on': [2]},
            {'title': 'Marketing Plan',   'category': 'Marketing',   'start_offset_minutes': 7 * DAY,    'duration_minutes': 2 * DAY,  'notes': 'Channels, messaging, timeline.',   'percent_complete': 0, 'depends_on': [1]},
            {'title': 'QA & Polish',      'category': 'QA',          'start_offset_minutes': 14 * DAY,   'duration_minutes': 3 * DAY,  'notes': 'Stabilize before launch.',         'percent_complete': 0, 'depends_on': [3]},
            {'title': 'Launch Assets',    'category': 'Marketing',   'start_offset_minutes': 15 * DAY,   'duration_minutes': 2 * DAY,  'notes': 'Landing page, posts, press.',      'percent_complete': 0, 'depends_on': [4]},
            {'title': 'Launch Day',       'category': 'Strategy',    'start_offset_minutes': 21 * DAY,   'duration_minutes': 480,      'notes': 'Ship it.',                         'percent_complete': 0, 'depends_on': [5, 6]},
        ],
    },
    'event': {
        'name': 'Event Plan',
        'description': 'Plan an event from goal-setting to event day: logistics, program, marketing, catering.',
        'categories': [
            {'name': 'Logistics', 'color': '#4adcff'},
            {'name': 'Program',   'color': '#818cf8'},
            {'name': 'Marketing', 'color': '#ffd84a'},
            {'name': 'Catering',  'color': '#34d399'},
        ],
        'tasks': [
            {'title': 'Define Goals',       'category': 'Program',   'start_offset_minutes': 0,        'duration_minutes': 120,     'notes': 'Audience, theme, success metrics.', 'percent_complete': 0, 'depends_on': []},
            {'title': 'Book Venue',         'category': 'Logistics', 'start_offset_minutes': 1 * DAY,  'duration_minutes': 240,     'notes': 'Confirm date and space.',           'percent_complete': 0, 'depends_on': [0]},
            {'title': 'Invite Speakers',    'category': 'Program',   'start_offset_minutes': 2 * DAY,  'duration_minutes': 480,     'notes': 'Line up the program.',              'percent_complete': 0, 'depends_on': [0]},
            {'title': 'Marketing Push',     'category': 'Marketing', 'start_offset_minutes': 5 * DAY,  'duration_minutes': 2 * DAY, 'notes': 'Promote and drive sign-ups.',       'percent_complete': 0, 'depends_on': [1]},
            {'title': 'Catering Order',     'category': 'Catering',  'start_offset_minutes': 10 * DAY, 'duration_minutes': 240,     'notes': 'Confirm headcount and menu.',        'percent_complete': 0, 'depends_on': [1]},
            {'title': 'Final Walkthrough',  'category': 'Logistics', 'start_offset_minutes': 14 * DAY, 'duration_minutes': 240,     'notes': 'Dry run the day-of plan.',           'percent_complete': 0, 'depends_on': [1, 2, 4]},
            {'title': 'Event Day',          'category': 'Program',   'start_offset_minutes': 15 * DAY, 'duration_minutes': 600,     'notes': 'Run the event.',                    'percent_complete': 0, 'depends_on': [5]},
        ],
    },
    'custom_shop': {
        'name': 'Custom Shop Build',
        'description': 'Build a detached workshop/shop on your property — from design and permits through '
                       'foundation, framing, utilities, inspections, and finish-out. ~3.5 months of '
                       'dependency-linked steps based on the standard residential build sequence.',
        'categories': [
            {'name': 'Planning & Design',    'color': '#818cf8'},
            {'name': 'Permits & Approvals',  'color': '#fbbf24'},
            {'name': 'Site & Foundation',    'color': '#ff8c4a'},
            {'name': 'Structure',            'color': '#4a88ff'},
            {'name': 'Utilities (MEP)',      'color': '#4adcff'},
            {'name': 'Interior',             'color': '#4aff9e'},
            {'name': 'Inspections',          'color': '#ff4a4a'},
            {'name': 'Finishing & Closeout', 'color': '#c44aff'},
        ],
        'tasks': [
            # ── Planning & Design ───────────────────────────────────────────────
            {'title': 'Define shop requirements & budget',   'category': 'Planning & Design',    'start_offset_minutes': 0,        'duration_minutes': 2 * DAY,  'notes': 'Intended use, size, power/water needs, and a working budget with contingency.',           'percent_complete': 0, 'depends_on': []},
            {'title': 'Choose building type & size',         'category': 'Planning & Design',    'start_offset_minutes': 2 * DAY,  'duration_minutes': 2 * DAY,  'notes': 'Stick-built vs. post-frame (pole barn); footprint, height, and door/window layout.',      'percent_complete': 0, 'depends_on': [0]},
            {'title': 'Engineered drawings & site plan',     'category': 'Planning & Design',    'start_offset_minutes': 4 * DAY,  'duration_minutes': 10 * DAY, 'notes': 'Foundation, structural, and electrical plans; site plan showing setbacks from property lines.', 'percent_complete': 0, 'depends_on': [1]},
            {'title': 'Soil test & site survey',             'category': 'Site & Foundation',    'start_offset_minutes': 4 * DAY,  'duration_minutes': 3 * DAY,  'notes': 'Verify soil bearing and grade; confirm buildable area and drainage.',                     'percent_complete': 0, 'depends_on': [1]},
            # ── Permits & Approvals ─────────────────────────────────────────────
            {'title': 'Submit building permit application',  'category': 'Permits & Approvals',  'start_offset_minutes': 14 * DAY, 'duration_minutes': 1 * DAY,  'notes': 'File site plan, foundation/structural and electrical drawings with the building dept.',   'percent_complete': 0, 'depends_on': [2, 3]},
            {'title': 'Permit review & approval',            'category': 'Permits & Approvals',  'start_offset_minutes': 15 * DAY, 'duration_minutes': 15 * DAY, 'notes': 'Zoning + building review. Allow 2–4 weeks; longer if a variance is required.',            'percent_complete': 0, 'depends_on': [4]},
            # ── Site & Foundation ───────────────────────────────────────────────
            {'title': 'Clear, grade & locate utilities',     'category': 'Site & Foundation',    'start_offset_minutes': 30 * DAY, 'duration_minutes': 4 * DAY,  'notes': 'Clear vegetation, rough grade, compact subgrade, and call 811 to mark underground lines.', 'percent_complete': 0, 'depends_on': [5]},
            {'title': 'Excavate & form footings',            'category': 'Site & Foundation',    'start_offset_minutes': 34 * DAY, 'duration_minutes': 2 * DAY,  'notes': 'Trench footings to frost depth; set forms to plan.',                                      'percent_complete': 0, 'depends_on': [6]},
            {'title': 'Rebar, vapor barrier & under-slab MEP','category': 'Site & Foundation',   'start_offset_minutes': 36 * DAY, 'duration_minutes': 3 * DAY,  'notes': 'Place rebar and 6-mil vapor barrier; rough any under-slab plumbing/conduit before pour.', 'percent_complete': 0, 'depends_on': [7]},
            {'title': 'Foundation pre-pour inspection',      'category': 'Inspections',          'start_offset_minutes': 39 * DAY, 'duration_minutes': 1 * DAY,  'notes': 'Required inspection of forms, steel, and vapor barrier BEFORE concrete is placed.',       'percent_complete': 0, 'depends_on': [8]},
            {'title': 'Pour concrete slab & foundation',     'category': 'Site & Foundation',    'start_offset_minutes': 40 * DAY, 'duration_minutes': 1 * DAY,  'notes': 'Pour ~4" slab with anchor bolts every ~6 ft; finish and control-joint.',                  'percent_complete': 0, 'depends_on': [9]},
            {'title': 'Concrete cure',                       'category': 'Site & Foundation',    'start_offset_minutes': 41 * DAY, 'duration_minutes': 7 * DAY,  'notes': 'Let the slab gain strength before framing (full design strength ~28 days).',              'percent_complete': 0, 'depends_on': [10]},
            # ── Structure ───────────────────────────────────────────────────────
            {'title': 'Frame exterior walls',                'category': 'Structure',            'start_offset_minutes': 48 * DAY, 'duration_minutes': 7 * DAY,  'notes': 'Treated sill plate, studs 16/24" OC, openings for doors/windows, double top plates.',     'percent_complete': 0, 'depends_on': [11]},
            {'title': 'Set roof trusses & sheathing',        'category': 'Structure',            'start_offset_minutes': 55 * DAY, 'duration_minutes': 4 * DAY,  'notes': 'Trusses 24" OC, roof sheathing and underlayment.',                                        'percent_complete': 0, 'depends_on': [12]},
            {'title': 'Install roofing',                     'category': 'Structure',            'start_offset_minutes': 59 * DAY, 'duration_minutes': 3 * DAY,  'notes': 'Metal panels or shingles; dry-in the building.',                                          'percent_complete': 0, 'depends_on': [13]},
            {'title': 'Exterior sheathing & house wrap',     'category': 'Structure',            'start_offset_minutes': 59 * DAY, 'duration_minutes': 3 * DAY,  'notes': 'Wall sheathing (OSB/ply) and weather-resistive barrier.',                                 'percent_complete': 0, 'depends_on': [13]},
            {'title': 'Install siding',                      'category': 'Structure',            'start_offset_minutes': 62 * DAY, 'duration_minutes': 5 * DAY,  'notes': 'Metal, fiber-cement, or wood siding with flashing.',                                      'percent_complete': 0, 'depends_on': [15]},
            {'title': 'Install windows & entry doors',       'category': 'Structure',            'start_offset_minutes': 62 * DAY, 'duration_minutes': 2 * DAY,  'notes': 'Set and flash windows and man-doors.',                                                    'percent_complete': 0, 'depends_on': [15]},
            {'title': 'Install overhead doors',              'category': 'Structure',            'start_offset_minutes': 62 * DAY, 'duration_minutes': 2 * DAY,  'notes': 'Garage/shop overhead doors, tracks, and openers.',                                        'percent_complete': 0, 'depends_on': [14]},
            # ── Utilities (MEP) ─────────────────────────────────────────────────
            {'title': 'Electrical rough-in',                 'category': 'Utilities (MEP)',      'start_offset_minutes': 62 * DAY, 'duration_minutes': 5 * DAY,  'notes': 'Sub-panel, circuits, outlets, lighting, 240V for tools/welder.',                          'percent_complete': 0, 'depends_on': [14]},
            {'title': 'Plumbing rough-in',                   'category': 'Utilities (MEP)',      'start_offset_minutes': 62 * DAY, 'duration_minutes': 3 * DAY,  'notes': 'Supply/drain for utility sink or bathroom (if included).',                                'percent_complete': 0, 'depends_on': [14]},
            {'title': 'HVAC / mini-split rough-in',          'category': 'Utilities (MEP)',      'start_offset_minutes': 64 * DAY, 'duration_minutes': 3 * DAY,  'notes': 'Set line sets and electrical for heating/cooling.',                                       'percent_complete': 0, 'depends_on': [14]},
            # ── Inspection (rough-in / pre-drywall) ─────────────────────────────
            {'title': 'Rough-in / pre-drywall inspection',   'category': 'Inspections',          'start_offset_minutes': 67 * DAY, 'duration_minutes': 1 * DAY,  'notes': 'Framing + electrical/plumbing/HVAC inspected together before insulation & drywall.',      'percent_complete': 0, 'depends_on': [19, 20, 21]},
            # ── Interior ────────────────────────────────────────────────────────
            {'title': 'Insulation (walls & ceiling)',        'category': 'Interior',             'start_offset_minutes': 68 * DAY, 'duration_minutes': 3 * DAY,  'notes': 'Batt or spray foam to target R-value; air-seal penetrations.',                            'percent_complete': 0, 'depends_on': [22]},
            {'title': 'Hang & finish drywall',               'category': 'Interior',             'start_offset_minutes': 71 * DAY, 'duration_minutes': 8 * DAY,  'notes': 'Hang, tape, mud, sand. Optional in a bare shop — skip for exposed framing.',              'percent_complete': 0, 'depends_on': [23]},
            {'title': 'Prime & paint interior',              'category': 'Interior',             'start_offset_minutes': 79 * DAY, 'duration_minutes': 4 * DAY,  'notes': 'Prime and topcoat walls/ceiling.',                                                        'percent_complete': 0, 'depends_on': [24]},
            {'title': 'Epoxy / seal concrete floor',         'category': 'Interior',             'start_offset_minutes': 83 * DAY, 'duration_minutes': 3 * DAY,  'notes': 'Grind, patch, and apply epoxy or sealer (slab fully cured by now).',                      'percent_complete': 0, 'depends_on': [25]},
            {'title': 'Electrical & lighting trim-out',      'category': 'Utilities (MEP)',      'start_offset_minutes': 83 * DAY, 'duration_minutes': 3 * DAY,  'notes': 'Devices, fixtures, panel labeling; HVAC equipment set.',                                  'percent_complete': 0, 'depends_on': [25]},
            {'title': 'Workbenches, shelving & storage',     'category': 'Interior',             'start_offset_minutes': 86 * DAY, 'duration_minutes': 5 * DAY,  'notes': 'Build out benches, cabinets, racks, and tool storage.',                                   'percent_complete': 0, 'depends_on': [26, 27]},
            # ── Finishing & Closeout ────────────────────────────────────────────
            {'title': 'Site grading, gutters & apron',       'category': 'Finishing & Closeout', 'start_offset_minutes': 67 * DAY, 'duration_minutes': 5 * DAY,  'notes': 'Final grade for drainage, gutters/downspouts, and concrete apron/driveway.',              'percent_complete': 0, 'depends_on': [16]},
            {'title': 'Final inspections',                   'category': 'Inspections',          'start_offset_minutes': 91 * DAY, 'duration_minutes': 1 * DAY,  'notes': 'Final building, electrical, and plumbing sign-offs / certificate of occupancy.',          'percent_complete': 0, 'depends_on': [28, 29]},
            {'title': 'Punch list & closeout',               'category': 'Finishing & Closeout', 'start_offset_minutes': 92 * DAY, 'duration_minutes': 3 * DAY,  'notes': 'Fix punch-list items, clean up, and move in.',                                            'percent_complete': 0, 'depends_on': [30]},
        ],
    },
}


def builtin_spec(slug):
    """Return the template spec dict for a built-in slug, or None."""
    return BUILTIN_TEMPLATES.get(slug)
