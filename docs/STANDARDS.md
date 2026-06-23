# Project standards & interchange formats (DoD-acquisition context)

Reference for which project-management standards and schedule data-interchange
formats apply to Timeline, and how each maps to the data model
(`Project → Event{start,end,depends_on,critical-path,percent_complete} → Task`,
plus templates citing OT 10 USC 4021/4022 and an MTA OTA template).

Compiled from a multi-source, adversarially fact-checked research pass (June 2026).
Confidence legend: **✅ verified** (primary source, survived adversarial review) ·
**⚠️ unconfirmed** (surfaced but not nailed to a primary standards-body page — verify
before citing officially).

## Summary table

| Item | Current version | When it applies | App mapping / gap |
|---|---|---|---|
| **MIL-STD-881** — WBS for Defense Materiel Items | ✅ **Rev F (2022)** | DoD materiel programs; standard WBS for contracts & reporting | `categories` ≈ informal WBS. **Gap:** no `wbs_code` on category/event |
| **ANSI/EIA-748** — EVMS | ✅ applied via **DoD EVMSIG (14 Mar 2019)**; long-standing **Rev D (2019, 32 guidelines)**. ⚠️ a **Rev E (2026), 32→27 guidelines** was surfaced — verify | EVM required above DoD contract-dollar thresholds | `percent_complete` is the seed of earned value. **Gap:** PV/EV/AC, a performance-measurement baseline, per-task earned-value technique |
| **Integrated Master Schedule** — DI-MGMT-81650 (+ IMP) | ✅ current DID | IMS deliverable on major contracts | `events` + `depends_on` + critical path = a CPM/IMS network. **Gap:** baseline dates, no dangling logic, vertical/horizontal traceability |
| **PASEG / GASP** (NDIA IPMD) | ✅ **PASEG v6.0 (Sept 2025)**; **GASP = 8 tenets** | Best-practice guide for schedule quality | Informs a schedule-health feature |
| **DCMA 14-Point Schedule Assessment** | ✅ metrics now in **PASEG Fig 10.2-1** | Schedule-health assessment by DCMA / program offices | Runs against the dependency graph. **Gap:** logic %, float, lead/lag, hard-constraint checks (⚠️ exact thresholds not pinned) |
| **DoDI 5000.02 / Adaptive Acquisition Framework**; **MTA = DoDI 5000.80**; OTs **10 USC 4021/4022/4023** | ✅ current | The acquisition pathways the templates cite | OT 4021/4022 + MTA templates already align; could add **4023 (production OT)** and MTA phase templates |
| **ISO 21508** — EVM in project/programme mgmt | ⚠️ **2026 revision** indicated (supersedes 2018) | General EVM | Aligns the EVM fields above |
| **ISO 21502** (PM guidance, ~2020) / **ISO 21511** (WBS, ~2018) / **PMI PMBOK** | ⚠️ current revisions **not independently confirmed** | General PM methodology | Methodology backdrop |
| **PMI Practice Standard for Scheduling** | ✅ **3rd edition** | CPM scheduling practice | Already implemented (critical path) |
| **MSPDI** — Microsoft Project Data Interchange (XML) | ✅ documented schema (Microsoft Learn) | Interop with MS Project | tasks/dates/deps/% ≈ 1:1 → import/export |
| **Primavera P6** — XER / P6 XML | ✅ documented (Oracle docs) | Interop with P6 (dominant in DoD program offices) | activities + relationships → import/export |
| **iCalendar** — IETF RFC 5545 | ✅ RFC 5545 | Calendar interop (Google/Apple/Outlook) | each event → `VEVENT` (DTSTART/DTEND) → easy export |

## Claims the fact-check overturned

- "PASEG is v5.0 (Sept 2022)" → **refuted**; current is **v6.0 (Sept 2025)**.
- "ISO 21508:2018 is current/broadly applicable" → **refuted**; superseded by a 2026 revision.

## Recommended adoption order (effort → payoff)

1. **iCalendar export** (low effort, high reach) — emit RFC 5545 `VEVENT`s. *No schema change.*
2. **WBS coding** (MIL-STD-881; unlocks IMS/EVM rollups) — add `wbs_code` (+ optional parent). *Small migration.*
3. **P6 or MSPDI export** (interop with program-office tools; lead with P6 for DoD) — events→activities, `depends_on`→relationships. *No schema change.*
4. **DCMA-14-style schedule-health view** (critical path already computed) — checks over `depends_on`: missing logic, dangling tasks, hard constraints, high float. *No schema change.*
5. **EVM-lite** (EIA-748 / ISO 21508) — add PV/AC per task so `percent_complete` → real earned value. *Larger migration + rollup logic.*

## Caveats

- **Verify before officially citing:** EIA-748 **Rev E (2026, 27 guidelines)** and **ISO 21508:2026**
  were surfaced but not nailed to a primary standards-body page; ISO 21502/21511 and PMBOK
  current revisions were not confirmed. The well-established anchors — MIL-STD-881F (2022),
  DoD EVMSIG (Mar 2019), DI-MGMT-81650, PASEG v6.0, DoDI 5000.80, the OT statutes, and the
  MSPDI/P6/RFC 5545 schemas — are solid.
- The research run logged one failed parallel branch, so ISO/PMBOK specifics came back thin.

## Primary sources

- MIL-STD-881 (DLA ASSIST, ident 36026): https://quicksearch.dla.mil/qsdocdetails.aspx?ident_number=36026
- DoD Earned Value Management System Interpretation Guide (EVMSIG, 14 Mar 2019): https://www.acq.osd.mil/asda/ae/ada/ipm/docs/DoD_EVMSIG_14MAR2019.pdf
- NDIA IPMD PASEG v6.0 (Sept 2025): https://s44115.pcdn.co/wp-content/uploads/2025/10/NDIA_IPMD_PASEG_Version6_September2025.pdf
- DAU Adaptive Acquisition Framework — Middle Tier Acquisition: https://aaf.dau.edu/aaf/mta/
- DAU AAF — Research Other Transactions: https://aaf.dau.edu/aaf/contracting-cone/ot/research/
- DoD Other Transactions Guide (July 2023): https://www.acq.osd.mil/asda/dpc/cp/policy/docs/guidebook/DoD%20OT%20Guide%20(July%202023)%20-%20508%20Update_11Jul2025.pdf
- ISO 21508: https://www.iso.org/standard/87899.html · https://www.iso.org/standard/63582.html
- PMI Practice Standard for Scheduling: https://www.pmi.org/-/media/pmi/documents/public/pdf/certifications/practice-standard-scheduling.pdf
- MSPDI XML schema (Microsoft Learn): https://learn.microsoft.com/en-us/office-project/xml-data-interchange/project-xml-data-interchange-schema-reference
- Primavera P6 import/export file formats (Oracle): https://docs.oracle.com/cd/F88968_01/English/admin/p6_pro_importing_exporting/import_export_file_formats.htm
- iCalendar — IETF RFC 5545: https://www.rfc-editor.org/rfc/rfc5545.html
