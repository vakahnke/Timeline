"""
Built-in project templates. Same shape as a saved ProjectTemplate's
`categories` / `tasks` JSON, so instantiation treats both identically.

Task timing is relative: `start_offset_minutes` is measured from the project's
chosen start datetime; `depends_on` holds indices into the task list.
"""

DAY = 1440        # minutes
MONTH = 30 * DAY  # ~1 month, for long acquisition-scale schedules

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
    'mta_ota': {
        'name': 'MTA Rapid Prototyping (OTA)',
        'description': 'A Middle Tier of Acquisition (MTA) Rapid Prototyping program (DoDI 5000.80 / 10 USC 4022) '
                       'executed with a prototype Other Transaction via a consortium. Per DAU\'s Adaptive Acquisition '
                       'Framework: starts at the initiation ADM, requirements within 6 months, documentation within '
                       '2 years, and prototype demonstrated within 5 years through the Outcome Determination ADM.',
        'categories': [
            {'name': 'Requirements',             'color': '#818cf8'},
            {'name': 'Acquisition Strategy',     'color': '#fbbf24'},
            {'name': 'OT Solicitation & Award',  'color': '#ff8c4a'},
            {'name': 'Prototype Development',     'color': '#4a88ff'},
            {'name': 'Test & Demonstration',     'color': '#4adcff'},
            {'name': 'Program Management',        'color': '#4aff9e'},
            {'name': 'Transition & Production',   'color': '#c44aff'},
        ],
        'tasks': [
            # ── Requirements (approved ≤ 6 months) ──────────────────────────────
            {'title': 'Identify capability gap & emerging need',     'category': 'Requirements',            'start_offset_minutes': 0,                'duration_minutes': 1 * MONTH,  'notes': 'Merit-based need from COCOMs/JCS; confirm fit for MTA rapid prototyping.',                 'percent_complete': 0, 'depends_on': []},
            {'title': 'Develop requirements document',               'category': 'Requirements',            'start_offset_minutes': 1 * MONTH,        'duration_minutes': 4 * MONTH,  'notes': 'Succinct requirements; MTA is not subject to JCIDS.',                                      'percent_complete': 0, 'depends_on': [0]},
            {'title': 'Requirements approval (≤ 6 months)',          'category': 'Requirements',            'start_offset_minutes': 5 * MONTH,        'duration_minutes': 1 * MONTH,  'notes': 'Requirement approved not more than 6 months after initiation.',                            'percent_complete': 0, 'depends_on': [1]},
            # ── Acquisition Strategy ────────────────────────────────────────────
            {'title': 'Develop MTA acquisition strategy',            'category': 'Acquisition Strategy',    'start_offset_minutes': 2 * MONTH,        'duration_minutes': 4 * MONTH,  'notes': 'Tailored strategy incl. schedule/technical/security risk and a transition plan.',         'percent_complete': 0, 'depends_on': [0]},
            {'title': 'Develop prototype OT strategy',               'category': 'Acquisition Strategy',    'start_offset_minutes': 4 * MONTH,        'duration_minutes': 2 * MONTH,  'notes': 'Use a prototype Other Transaction (10 USC 4022), executed via a consortium.',             'percent_complete': 0, 'depends_on': [3]},
            {'title': 'Program baseline & cost estimate',            'category': 'Acquisition Strategy',    'start_offset_minutes': 5 * MONTH,        'duration_minutes': 2 * MONTH,  'notes': 'Cost, schedule, and performance baseline for the prototype effort.',                      'percent_complete': 0, 'depends_on': [3]},
            {'title': 'Test & evaluation strategy',                  'category': 'Acquisition Strategy',    'start_offset_minutes': 5 * MONTH,        'duration_minutes': 2 * MONTH,  'notes': 'How prototype performance will be demonstrated/assessed in an operational environment.',   'percent_complete': 0, 'depends_on': [3]},
            {'title': 'MTA initiation — sign Acquisition Decision Memo (ADM)', 'category': 'Acquisition Strategy', 'start_offset_minutes': 7 * MONTH, 'duration_minutes': 3 * DAY, 'notes': 'AE signs ADM designating the MTA program; starts the 5-year clock.',                       'percent_complete': 0, 'depends_on': [2, 4, 5, 6]},
            # ── OT Solicitation & Award (via consortium) ────────────────────────
            {'title': 'Develop problem statement & solicitation',    'category': 'OT Solicitation & Award', 'start_offset_minutes': 7 * MONTH,        'duration_minutes': 1 * MONTH,  'notes': 'With the consortium manager, frame the problem statement and evaluation approach.',        'percent_complete': 0, 'depends_on': [7]},
            {'title': 'Issue Request for White Papers (RWP)',        'category': 'OT Solicitation & Award', 'start_offset_minutes': 8 * MONTH,        'duration_minutes': 1 * MONTH,  'notes': 'Solicit white papers from consortium members.',                                           'percent_complete': 0, 'depends_on': [8]},
            {'title': 'Evaluate white papers & down-select',         'category': 'OT Solicitation & Award', 'start_offset_minutes': 9 * MONTH,        'duration_minutes': 1 * MONTH,  'notes': 'Assess concepts against criteria; invite the strongest to propose.',                      'percent_complete': 0, 'depends_on': [9]},
            {'title': 'Issue Request for Prototype Proposals (RFPP)', 'category': 'OT Solicitation & Award', 'start_offset_minutes': 10 * MONTH,       'duration_minutes': 64800,      'notes': 'Detailed prototype proposals from down-selected offerors (~1.5 months).',                 'percent_complete': 0, 'depends_on': [10]},
            {'title': 'Evaluate prototype proposals',                'category': 'OT Solicitation & Award', 'start_offset_minutes': 496800,           'duration_minutes': 64800,      'notes': 'Technical + cost evaluation (~1.5 months); government sponsor approves selection.',        'percent_complete': 0, 'depends_on': [11]},
            {'title': 'Negotiate & award prototype OT agreement',    'category': 'OT Solicitation & Award', 'start_offset_minutes': 13 * MONTH,       'duration_minutes': 2 * MONTH,  'notes': 'Competitively awarded prototype OT (enables sole-source follow-on production later).',     'percent_complete': 0, 'depends_on': [12]},
            # ── Prototype Development ───────────────────────────────────────────
            {'title': 'Prototype design & systems engineering',      'category': 'Prototype Development',   'start_offset_minutes': 15 * MONTH,       'duration_minutes': 6 * MONTH,  'notes': 'Mature the design; define interfaces and build plan.',                                    'percent_complete': 0, 'depends_on': [13]},
            {'title': 'Fabricate / build prototype',                 'category': 'Prototype Development',   'start_offset_minutes': 21 * MONTH,       'duration_minutes': 12 * MONTH, 'notes': 'Build the fieldable prototype using innovative technology.',                               'percent_complete': 0, 'depends_on': [14]},
            {'title': 'Integration & checkout',                      'category': 'Prototype Development',   'start_offset_minutes': 33 * MONTH,       'duration_minutes': 4 * MONTH,  'notes': 'Integrate subsystems; bench/ground checkout before test.',                                'percent_complete': 0, 'depends_on': [15]},
            # ── Test & Demonstration ────────────────────────────────────────────
            {'title': 'Developmental test & evaluation (DT&E)',      'category': 'Test & Demonstration',    'start_offset_minutes': 36 * MONTH,       'duration_minutes': 6 * MONTH,  'notes': 'Verify performance against the requirement.',                                             'percent_complete': 0, 'depends_on': [16]},
            {'title': 'Operational demonstration',                   'category': 'Test & Demonstration',    'start_offset_minutes': 42 * MONTH,       'duration_minutes': 6 * MONTH,  'notes': 'Demonstrate the prototype in an operationally relevant environment.',                     'percent_complete': 0, 'depends_on': [17]},
            # ── Program Management (milestones) ─────────────────────────────────
            {'title': 'Program documentation complete (≤ 2 years)',  'category': 'Program Management',      'start_offset_minutes': 24 * MONTH,       'duration_minutes': 3 * DAY,    'notes': 'All necessary documentation complete NLT 2 years after program start.',                   'percent_complete': 0, 'depends_on': [7]},
            {'title': 'Governance review / IPR',                     'category': 'Program Management',      'start_offset_minutes': 30 * MONTH,       'duration_minutes': 3 * DAY,    'notes': 'Report status to governance bodies; update baseline as needed.',                          'percent_complete': 0, 'depends_on': [7]},
            # ── Transition & Production ─────────────────────────────────────────
            {'title': 'Evaluate prototype results',                  'category': 'Transition & Production', 'start_offset_minutes': 48 * MONTH,       'duration_minutes': 1 * MONTH,  'notes': 'Assess demonstration results against the requirement.',                                   'percent_complete': 0, 'depends_on': [18]},
            {'title': 'Outcome Determination ADM (transition decision)', 'category': 'Transition & Production', 'start_offset_minutes': 49 * MONTH,   'duration_minutes': 3 * DAY,    'notes': 'AE decision: transition to Rapid Fielding / a program of record, or end the effort.',     'percent_complete': 0, 'depends_on': [21]},
            {'title': 'Award follow-on production OT / transition',  'category': 'Transition & Production', 'start_offset_minutes': 49 * MONTH + 15 * DAY, 'duration_minutes': 5 * MONTH, 'notes': 'Sole-source follow-on production OT or transition to the next acquisition pathway.',       'percent_complete': 0, 'depends_on': [22]},
        ],
    },
}


def builtin_spec(slug):
    """Return the template spec dict for a built-in slug, or None."""
    return BUILTIN_TEMPLATES.get(slug)
