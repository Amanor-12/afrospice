from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = REPO_ROOT / "qa" / "AfroSpice_Test_Cases.xlsx"


@dataclass(frozen=True)
class Sheet:
    name: str
    columns: list[tuple[str, float]]
    rows: list[list[str]]
    validations: list[dict]
    conditional_formats: list[dict]


def col_letter(index: int) -> str:
    value = index
    result: list[str] = []
    while value:
        value, remainder = divmod(value - 1, 26)
        result.append(chr(65 + remainder))
    return "".join(reversed(result))


def inline_string_cell(ref: str, value: str, style_id: int) -> str:
    text = "" if value is None else str(value)
    return (
        f'<c r="{ref}" t="inlineStr" s="{style_id}">'
        f"<is><t xml:space=\"preserve\">{escape(text)}</t></is></c>"
    )


def build_row_xml(row_index: int, values: list[str], header: bool) -> str:
    style_id = 1 if header else 2
    spans = f"1:{len(values)}"
    row_attrs = f'r="{row_index}" spans="{spans}"'
    if header:
        row_attrs += ' ht="28" customHeight="1"'
    cells = []
    for column_index, value in enumerate(values, start=1):
        ref = f"{col_letter(column_index)}{row_index}"
        cells.append(inline_string_cell(ref, value, style_id))
    return f"<row {row_attrs}>{''.join(cells)}</row>"


def build_cols_xml(columns: list[tuple[str, float]]) -> str:
    cells = []
    for index, (_, width) in enumerate(columns, start=1):
        cells.append(
            f'<col min="{index}" max="{index}" width="{width}" customWidth="1"/>'
        )
    return "<cols>" + "".join(cells) + "</cols>"


def build_data_validations_xml(validations: list[dict]) -> str:
    if not validations:
        return ""
    entries = []
    for validation in validations:
        entries.append(
            f'<dataValidation type="list" allowBlank="1" showErrorMessage="1" '
            f'showInputMessage="1" sqref="{validation["range"]}">'
            f"<formula1>{escape(validation['formula'])}</formula1>"
            "</dataValidation>"
        )
    return f'<dataValidations count="{len(entries)}">{"".join(entries)}</dataValidations>'


def build_conditional_formatting_xml(rules: list[dict]) -> str:
    if not rules:
        return ""
    groups = []
    for group in rules:
        entries = []
        for priority, rule in enumerate(group["rules"], start=1):
            entries.append(
                f'<cfRule type="expression" dxfId="{rule["dxfId"]}" priority="{priority}">'
                f"<formula>{escape(rule['formula'])}</formula>"
                "</cfRule>"
            )
        groups.append(
            f'<conditionalFormatting sqref="{group["range"]}">{"".join(entries)}</conditionalFormatting>'
        )
    return "".join(groups)


def build_sheet_xml(sheet: Sheet) -> str:
    column_count = len(sheet.columns)
    row_count = len(sheet.rows)
    last_cell = f"{col_letter(column_count)}{row_count}"
    rows_xml = [build_row_xml(1, [heading for heading, _ in sheet.columns], header=True)]
    for row_index, row in enumerate(sheet.rows[1:], start=2):
        rows_xml.append(build_row_xml(row_index, row, header=False))

    return "\n".join(
        [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
            f'  <dimension ref="A1:{last_cell}"/>',
            "  <sheetViews>",
            '    <sheetView workbookViewId="0">',
            '      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
            '      <selection pane="bottomLeft" activeCell="A2" sqref="A2"/>',
            "    </sheetView>",
            "  </sheetViews>",
            '  <sheetFormatPr defaultRowHeight="18"/>',
            f"  {build_cols_xml(sheet.columns)}",
            f"  <sheetData>{''.join(rows_xml)}</sheetData>",
            f'  <autoFilter ref="A1:{last_cell}"/>',
            f"  {build_data_validations_xml(sheet.validations)}",
            f"  {build_conditional_formatting_xml(sheet.conditional_formats)}",
            '  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>',
            "</worksheet>",
        ]
    )


def build_styles_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font>
      <sz val="11"/>
      <color rgb="FF0F172A"/>
      <name val="Aptos"/>
      <family val="2"/>
    </font>
    <font>
      <b/>
      <sz val="11"/>
      <color rgb="FFFFFFFF"/>
      <name val="Aptos"/>
      <family val="2"/>
    </font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill>
      <patternFill patternType="solid">
        <fgColor rgb="FF1D4ED8"/>
        <bgColor indexed="64"/>
      </patternFill>
    </fill>
  </fills>
  <borders count="2">
    <border>
      <left/><right/><top/><bottom/><diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment vertical="top" wrapText="1"/>
    </xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
  <dxfs count="8">
    <dxf>
      <fill><patternFill patternType="solid"><fgColor rgb="FFD1FAE5"/><bgColor indexed="64"/></patternFill></fill>
      <font><color rgb="FF065F46"/><b/></font>
    </dxf>
    <dxf>
      <fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/><bgColor indexed="64"/></patternFill></fill>
      <font><color rgb="FF991B1B"/><b/></font>
    </dxf>
    <dxf>
      <fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill>
      <font><color rgb="FF92400E"/><b/></font>
    </dxf>
    <dxf>
      <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
      <font><color rgb="FF475569"/><b/></font>
    </dxf>
    <dxf>
      <fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill>
      <font><color rgb="FF1D4ED8"/><b/></font>
    </dxf>
    <dxf>
      <fill><patternFill patternType="solid"><fgColor rgb="FFFDE68A"/><bgColor indexed="64"/></patternFill></fill>
      <font><color rgb="FF92400E"/><b/></font>
    </dxf>
    <dxf>
      <fill><patternFill patternType="solid"><fgColor rgb="FFD1FAE5"/><bgColor indexed="64"/></patternFill></fill>
      <font><color rgb="FF166534"/><b/></font>
    </dxf>
    <dxf>
      <fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill>
      <font><color rgb="FF4B5563"/><b/></font>
    </dxf>
  </dxfs>
</styleSheet>
"""


def build_content_types_xml(sheet_count: int) -> str:
    overrides = [
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    ]
    for index in range(1, sheet_count + 1):
        overrides.append(
            f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
    return "\n".join(
        [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            '  <Default Extension="xml" ContentType="application/xml"/>',
            *[f"  {override}" for override in overrides],
            "</Types>",
        ]
    )


def build_root_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"""


def build_workbook_xml(sheets: list[Sheet]) -> str:
    entries = []
    for index, sheet in enumerate(sheets, start=1):
        entries.append(
            f'<sheet name="{escape(sheet.name)}" sheetId="{index}" r:id="rId{index}"/>'
        )
    return "\n".join(
        [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
            '          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
            f"  <sheets>{''.join(entries)}</sheets>",
            "</workbook>",
        ]
    )


def build_workbook_rels_xml(sheet_count: int) -> str:
    entries = []
    for index in range(1, sheet_count + 1):
        entries.append(
            f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>'
        )
    entries.append(
        f'<Relationship Id="rId{sheet_count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    )
    return "\n".join(
        [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            *[f"  {entry}" for entry in entries],
            "</Relationships>",
        ]
    )


def build_core_xml() -> str:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/"
                   xmlns:dcterms="http://purl.org/dc/terms/"
                   xmlns:dcmitype="http://purl.org/dc/dcmitype/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>AfroSpice Test Cases</dc:title>
  <dc:creator>AfroSpice</dc:creator>
  <cp:lastModifiedBy>AfroSpice</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>
"""


def build_app_xml(sheets: list[Sheet]) -> str:
    titles = "".join([f"<vt:lpstr>{escape(sheet.name)}</vt:lpstr>" for sheet in sheets])
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
            xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Excel</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>
      <vt:variant><vt:i4>{len(sheets)}</vt:i4></vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="{len(sheets)}" baseType="lpstr">
      {titles}
    </vt:vector>
  </TitlesOfParts>
  <Company>AfroSpice</Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0000</AppVersion>
</Properties>
"""


def uat_status_rules(column_letter: str, row_start: int, row_end: int) -> list[dict]:
    return [
        {
            "range": f"{column_letter}{row_start}:{column_letter}{row_end}",
            "rules": [
                {"dxfId": 0, "formula": f'EXACT(${column_letter}{row_start},"Passed")'},
                {"dxfId": 1, "formula": f'EXACT(${column_letter}{row_start},"Failed")'},
                {"dxfId": 2, "formula": f'EXACT(${column_letter}{row_start},"Blocked")'},
                {"dxfId": 4, "formula": f'EXACT(${column_letter}{row_start},"In Progress")'},
                {"dxfId": 3, "formula": f'EXACT(${column_letter}{row_start},"Not Run")'},
            ],
        }
    ]


def bug_status_rules(column_letter: str, row_start: int, row_end: int) -> list[dict]:
    return [
        {
            "range": f"{column_letter}{row_start}:{column_letter}{row_end}",
            "rules": [
                {"dxfId": 1, "formula": f'EXACT(${column_letter}{row_start},"Open")'},
                {"dxfId": 4, "formula": f'EXACT(${column_letter}{row_start},"In Progress")'},
                {"dxfId": 5, "formula": f'EXACT(${column_letter}{row_start},"Ready for Retest")'},
                {"dxfId": 6, "formula": f'EXACT(${column_letter}{row_start},"Closed")'},
                {"dxfId": 7, "formula": f'EXACT(${column_letter}{row_start},"Deferred")'},
            ],
        }
    ]


def append_route_column(
    columns: list[tuple[str, float]],
    rows: list[list[str]],
    route_map: dict[str, str],
    header: str = "Route / Endpoint",
    width: float = 34,
) -> tuple[list[tuple[str, float]], list[list[str]]]:
    next_columns = [*columns, (header, width)]
    next_rows: list[list[str]] = []
    for index, row in enumerate(rows):
        if index == 0:
            next_rows.append([*row, header])
            continue
        test_id = row[0]
        next_rows.append([*row, route_map.get(test_id, "N/A")])
    return next_columns, next_rows


def apply_row_updates(
    columns: list[tuple[str, float]],
    rows: list[list[str]],
    updates: dict[str, dict[str, str]],
) -> list[list[str]]:
    header = [label for label, _ in columns]
    column_index = {label: idx for idx, label in enumerate(header)}
    next_rows = [rows[0]]
    for row in rows[1:]:
        row_id = row[0]
        next_row = list(row)
        for field, value in updates.get(row_id, {}).items():
            if field in column_index:
                next_row[column_index[field]] = value
        next_rows.append(next_row)
    return next_rows


def make_sheets() -> list[Sheet]:
    common_assignees = '"Owner,QA Lead,Frontend,Backend,Ops,Support"'
    uat_statuses = '"Not Run,Passed,Failed,Blocked,In Progress"'
    bug_statuses = '"Open,In Progress,Ready for Retest,Closed,Deferred"'
    priorities = '"P1,P2,P3"'
    severities = '"Critical,High,Medium,Low"'

    overview_columns = [("Field", 28), ("Value", 110)]
    overview_rows = [
        ["Field", "Value"],
        ["Product", "AfroSpice Owner Workspace"],
        [
            "Scope",
            "Owner-only retail operations workspace covering dashboard, assistant, settings, inventory command, POS, orders, refunds, customers, suppliers, user management, deployment smoke, and post-release monitoring.",
        ],
        ["Current seeded reference data", "50 products | 8 suppliers | 12 customers | 7 users | 16 sales"],
        [
            "Primary release goal",
            "Verify the app is production-ready for owner operations with correct routing, dark mode parity, POS checkout and receipt flow, refund approvals, settings persistence, notifications, deployment smoke, and assistant reliability.",
        ],
        [
            "Execution model",
            "Use dropdown columns for Severity, Assigned To, and Status while executing UAT. Capture screenshots, script output, logs, and receipt evidence directly in the Evidence and Notes fields.",
        ],
        [
            "Critical flows",
            "1. Owner sign-in with PIN or Windows Hello\n2. Dashboard and route action cards\n3. Executive assistant question, follow-up, and navigation\n4. Settings save, theme toggle, and notifications\n5. POS search, pagination, sale, and print\n6. Orders refund request and owner approval\n7. Customer loyalty and checkout recognition\n8. User management routes and staff records\n9. Dark mode and zoom sweep\n10. Backend health, readiness, and data quality\n11. Deployment smoke and monitoring",
        ],
        [
            "Pass criteria",
            "All P1 owner flows pass, release verification is green, no blocking dark-mode or routing defects remain, and deployment smoke plus monitoring checks are signed off.",
        ],
        [
            "Workbook usage",
            "Core Test Cases = core owner UAT. Owner Deep Dive = full route-by-route owner coverage. API & Security = backend and access checks. Data & Imports = seed, integrity, and import checks. Environment Matrix = browser, theme, zoom, and device coverage. Release Checklist = release sign-off. Non-Functional = performance and usability. Deployment Smoke = go-live pass. Monitoring Checks = post-release watchlist. Bug Log = live defect tracker.",
        ],
    ]

    test_strategy_columns = [
        ("Layer", 18),
        ("Purpose", 34),
        ("Primary Scope", 48),
        ("Execution Type", 18),
        ("Evidence Source", 34),
        ("Release Standard", 34),
    ]
    test_strategy_rows = [
        [heading for heading, _ in test_strategy_columns],
        [
            "Unit Tests",
            "Validate isolated logic before cross-system execution.",
            "Backend ML helpers, forecast math, payload transforms, and utility functions.",
            "Automated",
            "qa/evidence/logs/pytest-unit.log",
            "All deterministic backend logic should remain green before release.",
        ],
        [
            "Integration Tests",
            "Prove backend workflows and verification scripts work together correctly.",
            "Runtime checks, data quality, transaction readiness, backup and restore, and package audits.",
            "Automated",
            "qa/evidence/logs/verify-release-local.log and audit logs",
            "Core backend and release verification should pass with no blocking failures.",
        ],
        [
            "Browser E2E",
            "Validate owner-facing workflows through the real UI shell.",
            "Assistant, routing integrity, theme bootstrap, critical owner routes, and staff/refund flows.",
            "Automated",
            "qa/evidence/logs/e2e-owner-suite.log and screenshots",
            "Critical owner journeys should pass in the browser before signoff.",
        ],
        [
            "Manual UAT",
            "Confirm business behavior that automation cannot fully prove.",
            "Visual QA, copy review, real printer checks, usability, and owner acceptance.",
            "Manual",
            "Workbook evidence fields and screenshots",
            "Owner should sign off after business-critical manual checks complete.",
        ],
        [
            "Deployment Smoke",
            "Validate the app after deployment or environment rebuild.",
            "Login, dashboard, assistant, settings, refunds, customer detail, staff detail, health, and readiness.",
            "Manual + CLI",
            "Deployment Smoke sheet and readiness logs",
            "No release should go live without a clean smoke pass.",
        ],
        [
            "Monitoring Checks",
            "Verify post-release visibility and operational safety.",
            "Health, readiness, backups, alerting, assistant responsiveness, and UI drift watchpoints.",
            "Manual + Ops",
            "Monitoring Checks sheet and ops logs",
            "Ops should be able to detect failures quickly after release.",
        ],
        [
            "Non-Functional",
            "Measure quality attributes beyond basic correctness.",
            "Load, performance, reliability, accessibility, usability, dark mode, zoom, and resilience.",
            "Mixed",
            "Load logs, screenshots, and manual notes",
            "System must remain stable, readable, and usable under realistic conditions.",
        ],
    ]

    core_columns = [
        ("ID", 14), ("Module", 18), ("Feature", 30), ("Priority", 10), ("Severity", 12),
        ("Type", 10), ("Preconditions", 26), ("Test Steps", 42), ("Expected Result", 42),
        ("Evidence", 24), ("Assigned To", 16), ("Status", 14), ("Actual Result", 24),
        ("Defect ID", 16), ("Notes", 20),
    ]
    core_rows = [
        [heading for heading, _ in core_columns],
        ["AUTH-001", "Authentication", "Owner PIN sign-in", "P1", "Critical", "Manual", "App running, login page visible", "1. Open AfroSpice\n2. Enter valid owner PIN\n3. Submit login", "Owner is authenticated and lands on the dashboard without layout breakage.", "Dashboard screenshot", "Owner", "Not Run", "", "", ""],
        ["AUTH-002", "Authentication", "Windows Hello sign-in", "P2", "High", "Manual", "Passkey enrolled on owner device", "1. Open login page\n2. Choose fingerprint sign-in\n3. Complete Windows Hello prompt", "Owner is authenticated and lands on the dashboard.", "Login evidence", "Owner", "Not Run", "", "", ""],
        ["AUTH-003", "Authentication", "Invalid PIN rejection", "P1", "High", "Manual", "Login page visible", "1. Enter invalid PIN\n2. Submit login", "App rejects the PIN without crashing or exposing privileged routes.", "Error screenshot", "QA Lead", "Not Run", "", "", ""],
        ["DASH-001", "Dashboard", "Dashboard shell renders", "P1", "Critical", "Manual", "Owner signed in", "1. Open dashboard\n2. Verify cards, stats, and quick actions", "Dashboard loads with aligned cards, correct metrics, and no blank sections.", "Dashboard screenshot", "Owner", "Not Run", "", "", ""],
        ["DASH-002", "Dashboard", "Quick action cards route correctly", "P1", "High", "Automated", "Owner signed in", "1. Click Open replenishment\n2. Click Review forecasts\n3. Click Open terminal\n4. Click Check staff", "Each card routes to the intended owner workflow.", "Playwright run", "Frontend", "Not Run", "", "", ""],
        ["AI-001", "Assistant", "Assistant dock opens and closes cleanly", "P1", "High", "Automated", "Owner signed in", "1. Open assistant dock\n2. Close dock\n3. Reopen dock", "Dock opens with clean layout and closes without leaving stale overlays.", "Playwright run", "Frontend", "Not Run", "", "", ""],
        ["AI-002", "Assistant", "Revenue question returns grounded answer", "P1", "High", "Automated", "Owner signed in, seeded sales present", "1. Ask about revenue\n2. Wait for reply", "Reply references live workspace data and follow-up prompts refresh.", "Assistant screenshot", "Owner", "Not Run", "", "", ""],
        ["AI-003", "Assistant", "Action follow-up navigates to destination", "P1", "High", "Automated", "Assistant dock open", "1. Submit a guided assistant question\n2. Click an action follow-up", "Destination page opens with the expected focus state.", "Playwright run", "Frontend", "Not Run", "", "", ""],
        ["SET-001", "Settings", "Store settings persist", "P1", "Critical", "Manual", "Owner signed in, settings page open", "1. Edit receipt footer\n2. Save changes\n3. Reload page", "Updated value persists after reload.", "Settings screenshot", "Owner", "Not Run", "", "", ""],
        ["SET-002", "Settings", "Theme toggle persists", "P1", "High", "Manual", "Settings page open", "1. Toggle dark mode\n2. Navigate across pages\n3. Reload app", "Theme remains consistent across the workspace after reload.", "Theme screenshots", "Owner", "Not Run", "", "", ""],
        ["SET-003", "Settings", "Notification mute setting works", "P2", "Medium", "Manual", "Notifications enabled", "1. Disable notification sound\n2. Trigger a notification\n3. Re-enable notification sound", "Sound obeys the setting without affecting unread notification count.", "Settings notes", "Owner", "Not Run", "", "", ""],
        ["INV-001", "Inventory", "Inventory command quick routes", "P1", "High", "Manual", "Owner signed in", "1. Open inventory command\n2. Use quick route pills", "Each route pill shows as a pill button and opens the intended section.", "Inventory screenshot", "Owner", "Not Run", "", "", ""],
        ["POSD-001", "POS Dashboard", "POS dashboard quick actions", "P2", "Medium", "Manual", "Owner signed in", "1. Open POS dashboard\n2. Use directory, replenishment, catalog, and operations shortcuts", "Cards render with correct spacing and route without layout drift.", "POS dashboard screenshot", "Owner", "Not Run", "", "", ""],
        ["POS-001", "POS", "POS search and pagination", "P1", "High", "Manual", "POS open with seeded catalog", "1. Search product catalog\n2. Change category\n3. Move to another page of results", "Owner can browse the full 50-product catalog without missing items.", "POS screenshot", "Owner", "Not Run", "", "", ""],
        ["POS-002", "POS", "Checkout and receipt print", "P1", "Critical", "Manual", "POS open, printer or Save as PDF available", "1. Add items to cart\n2. Collect payment\n3. Confirm print dialog opens", "Sale saves, receipt dialog opens, and manual reprint stays available.", "Printed receipt PDF", "Owner", "Not Run", "", "", ""],
        ["ORD-001", "Orders", "Order ledger filters and routing", "P1", "High", "Manual", "Orders page open", "1. Use search\n2. Use status controls\n3. Open order details", "Ledger updates correctly and routes remain within owner workflows.", "Orders screenshot", "Owner", "Not Run", "", "", ""],
        ["ORD-002", "Refunds", "Refund request requires owner PIN", "P1", "Critical", "Automated", "Refund desk available, paid order exists", "1. Open refund desk\n2. Prepare refund request\n3. Attempt owner approval without PIN\n4. Enter owner PIN", "Approval remains locked until the current owner PIN is entered.", "Playwright run", "Backend", "Not Run", "", "", ""],
        ["CUS-001", "Customers", "Customer detail dark mode parity", "P1", "High", "Manual", "Customer record open in dark mode", "1. Open customer detail\n2. Inspect profile, pricing, and note panels", "No light panels leak into dark mode; text and chips remain readable.", "Customer screenshots", "Owner", "Not Run", "", "", ""],
        ["CUS-002", "Customers", "Loyalty pricing recognition", "P2", "Medium", "Manual", "Customer with loyalty profile exists", "1. Open customer record\n2. Verify loyalty tier and checkout recognition sections", "Loyalty record shows current tier, pricing eligibility, and dispatch readiness.", "Customer screenshot", "Owner", "Not Run", "", "", ""],
        ["USR-001", "User Management", "Invite and view routing", "P1", "Critical", "Automated", "Users page open", "1. Click Invite User\n2. Click View on a staff row", "Invite opens staff creation. View opens the staff record instead of inventory.", "Playwright run", "Frontend", "Not Run", "", "", ""],
        ["USR-002", "User Management", "Staff record security states", "P1", "High", "Manual", "Staff record open", "1. Open Security tab\n2. Change status selectors\n3. Verify state cards", "Security, Access, Profile, and Audit sections update correctly with owner-safe colors.", "Staff record screenshot", "Owner", "Not Run", "", "", ""],
        ["NTF-001", "Notifications", "Notification bell and feed", "P2", "Medium", "Manual", "Owner signed in", "1. Open notifications\n2. Acknowledge an alert", "Unread count and acknowledgement state update correctly.", "Notification screenshot", "Owner", "Not Run", "", "", ""],
        ["REL-001", "Release", "Local release gate", "P1", "Critical", "Automated", "Dependencies installed", "1. Run npm run verify:release:local", "Release gate completes successfully without failures.", "CLI output", "Backend", "Not Run", "", "", ""],
    ]

    release_columns = [
        ("ID", 12), ("Stage", 18), ("Checkpoint", 36), ("Owner", 16),
        ("Evidence", 30), ("Severity", 12), ("Status", 14), ("Notes", 24),
    ]
    release_rows = [
        [heading for heading, _ in release_columns],
        ["REL-01", "Preflight", "Dependencies install cleanly", "Backend", "npm ci logs", "High", "Not Run", ""],
        ["REL-02", "Preflight", "No production audit vulnerabilities", "Backend", "npm audit --omit=dev", "Critical", "Not Run", ""],
        ["REL-03", "Application", "Local release gate passes", "QA Lead", "verify:release:local output", "Critical", "Not Run", ""],
        ["REL-04", "Application", "Focused browser suite passes", "Frontend", "Playwright output", "High", "Not Run", ""],
        ["REL-05", "Data", "Reference data bootstrap succeeds", "Backend", "db:bootstrap output", "High", "Not Run", ""],
        ["REL-06", "Performance", "Load smoke passes", "Ops", "verify:load:smoke output", "High", "Not Run", ""],
        ["REL-07", "Performance", "Load proof passes", "Ops", "verify:load:proof output", "High", "Not Run", ""],
        ["REL-08", "Security", "Host allowlist rejects invalid host", "Backend", "owner workflow verification", "High", "Not Run", ""],
        ["REL-09", "Resilience", "Backup verify and restore drill pass", "Backend", "verify:backup + verify:restore", "Critical", "Not Run", ""],
        ["REL-10", "Handoff", "Workbook and bug log delivered", "QA Lead", "AfroSpice_Test_Cases.xlsx", "Medium", "Not Run", ""],
    ]

    regression_columns = [
        ("Module", 20), ("Primary Routes", 28), ("Core Owner Scenarios", 44),
        ("Automated Coverage", 30), ("Manual Coverage", 28), ("Residual Risk", 24),
    ]
    regression_rows = [
        [heading for heading, _ in regression_columns],
        ["Authentication", "/login", "PIN sign-in, passkey sign-in, rejection path", "owner-assistant/theme/bootstrap suite", "Owner login smoke", "Low"],
        ["Dashboard", "/dashboard", "Hero actions, stat cards, live state strip", "production-surfaces", "Visual polish and routing", "Medium"],
        ["Assistant", "global dock", "Open, ask, follow-up, navigate", "owner-assistant", "Prompt quality review", "Medium"],
        ["Settings", "/settings", "Save, theme, notifications, biometrics", "production-surfaces", "Persistence and layout review", "Medium"],
        ["Inventory / POS Dashboard", "/inventory", "Route pills, catalog studio, reorder planner", "production-surfaces", "Owner workflow review", "Medium"],
        ["POS", "/pos", "Search, pagination, checkout, print", "release gate", "Printer device smoke", "Medium"],
        ["Orders / Refunds", "/orders, /orders/refunds", "Ledger view, refund request, owner PIN approval", "route-integrity + release gate", "Refund policy review", "Medium"],
        ["Customers", "/customers/:id", "Customer detail, loyalty, checkout recognition", "production-surfaces", "Dark mode review", "Medium"],
        ["User Management", "/users, /users/staff/:id", "Invite, view, staff record states", "route-integrity + production-surfaces", "Role/status review", "Medium"],
    ]

    non_functional_columns = [
        ("Area", 22), ("Scenario", 42), ("Target / Goal", 28),
        ("Method", 24), ("Status", 14), ("Notes", 28),
    ]
    non_functional_rows = [
        [heading for heading, _ in non_functional_columns],
        ["Performance", "Public API smoke under nominal owner load", "p95 < 500ms", "verify:load:smoke", "Not Run", ""],
        ["Performance", "Mixed owner workflow proof load", "All 200s under scripted proof run", "verify:load:proof", "Not Run", ""],
        ["Reliability", "Release gate stability", "Pass on clean local runtime", "verify:release:local", "Not Run", ""],
        ["Accessibility", "Dark mode readability", "No unreadable text or light leak", "Owner walkthrough", "Not Run", ""],
        ["Usability", "Browser zoom sweep 110%-150%", "Sidebar and commands stay usable", "Manual sweep", "Not Run", ""],
        ["Security", "Host validation and auth rejection", "Invalid host and unauthenticated calls rejected", "Runtime verification", "Not Run", ""],
        ["Security", "Owner PIN gating on refunds", "Approval impossible without current owner PIN", "Refund walkthrough", "Not Run", ""],
        ["Data Integrity", "Seeded reference data quality", "0 issues / 0 warnings", "verify:data-quality", "Not Run", ""],
    ]

    deployment_columns = [
        ("Step ID", 14), ("Area", 20), ("Action", 36), ("Expected Result", 42),
        ("Evidence", 24), ("Owner", 16), ("Status", 14), ("Notes", 24),
    ]
    deployment_rows = [
        [heading for heading, _ in deployment_columns],
        ["SMK-01", "Startup", "Open landing route and sign in as owner", "App loads, login succeeds, dashboard visible", "Screenshot", "Owner", "Not Run", ""],
        ["SMK-02", "Assistant", "Open assistant and ask a revenue question", "Grounded answer returns without UI breakage", "Screenshot", "Owner", "Not Run", ""],
        ["SMK-03", "Settings", "Save a harmless settings change and revert it", "Save succeeds and persists", "Screenshot", "Owner", "Not Run", ""],
        ["SMK-04", "POS", "Sell one ticket and open print dialog", "Sale saves and print dialog opens", "Receipt evidence", "Owner", "Not Run", ""],
        ["SMK-05", "Orders", "Submit a refund request on a paid order", "Refund desk opens and draft saves", "Screenshot", "Owner", "Not Run", ""],
        ["SMK-06", "Customers", "Open one customer record", "Loyalty and recognition sections render cleanly", "Screenshot", "Owner", "Not Run", ""],
        ["SMK-07", "Users", "Open one staff record", "Security and audit sections render cleanly", "Screenshot", "Owner", "Not Run", ""],
        ["SMK-08", "Monitoring", "Confirm health/readiness endpoints", "Health and readiness return expected state", "CLI output", "Ops", "Not Run", ""],
    ]

    monitoring_columns = [
        ("Check ID", 14), ("Signal", 26), ("What To Watch", 40), ("Source", 28),
        ("Threshold / Expectation", 28), ("Owner", 16), ("Status", 14), ("Notes", 24),
    ]
    monitoring_rows = [
        [heading for heading, _ in monitoring_columns],
        ["MON-01", "Application uptime", "API and frontend availability", "Health checks / reverse proxy", "No unexpected downtime", "Ops", "Not Run", ""],
        ["MON-02", "Assistant errors", "Owner assistant request failures", "Backend logs / observability hook", "0 blocking failures", "Backend", "Not Run", ""],
        ["MON-03", "Auth failures", "Unexpected login rejection spikes", "User access events", "Investigate unusual spikes", "Backend", "Not Run", ""],
        ["MON-04", "Refund workflow", "Refund queue and owner decisions", "Sales / audit logs", "No stuck refund approvals", "Owner", "Not Run", ""],
        ["MON-05", "Notifications", "Unread count and acknowledgement flow", "Notification API", "Counts remain consistent", "Owner", "Not Run", ""],
        ["MON-06", "Data growth", "Sales, inventory movement, audit log growth", "Mongo collections", "Counts increase as business events occur", "Ops", "Not Run", ""],
        ["MON-07", "Backups", "Snapshot and restore posture", "Backup verification", "Scheduled snapshots remain valid", "Ops", "Not Run", ""],
        ["MON-08", "Theme / UI drift", "Dark mode and dashboard card regressions", "Owner visual check", "No high-visibility UI drift", "Frontend", "Not Run", ""],
    ]

    deep_dive_columns = core_columns
    deep_dive_rows = [
        [heading for heading, _ in deep_dive_columns],
        ["DASH-101", "Dashboard", "Dashboard stat cards reflect latest seeded data", "P1", "High", "Manual", "Owner signed in", "1. Open dashboard\n2. Compare revenue/orders/stock cards with latest seeded data", "Hero stats match current workspace data and do not show stale placeholders.", "Dashboard screenshot", "Owner", "Not Run", "", "", ""],
        ["DASH-102", "Dashboard", "Dashboard action card hover and CTA state", "P2", "Medium", "Manual", "Dashboard open in light mode", "1. Hover each action card\n2. Inspect CTA pill treatment\n3. Click each CTA", "Cards animate cleanly, CTAs remain styled as pills, and clicks route correctly.", "Video or screenshots", "Owner", "Not Run", "", "", ""],
        ["DASH-103", "Dashboard", "Dashboard dark mode parity", "P1", "High", "Manual", "Dashboard open in dark mode", "1. Toggle dark mode\n2. Inspect hero, stats, and action cards", "No light surfaces leak into dark mode and text remains readable.", "Dark mode screenshot", "Owner", "Not Run", "", "", ""],
        ["AI-101", "Assistant", "Assistant reset clears thread state", "P2", "Medium", "Manual", "Assistant dock open with conversation history", "1. Ask a question\n2. Click Reset", "Thread, follow-up chips, and composer return to a clean initial state.", "Assistant screenshot", "Owner", "Not Run", "", "", ""],
        ["AI-102", "Assistant", "Assistant handles long grounded answer", "P2", "Medium", "Manual", "Assistant dock open", "1. Ask a multi-part business question\n2. Scroll the response", "Reply remains readable without overflow or clipped cards.", "Assistant screenshot", "Owner", "Not Run", "", "", ""],
        ["AI-103", "Assistant", "Assistant dark mode parity", "P1", "High", "Manual", "Assistant dock open in dark mode", "1. Toggle dark mode\n2. Inspect header, chips, messages, input, and send button", "Assistant keeps a consistent dark surface with no mixed light controls.", "Dark mode screenshot", "Owner", "Not Run", "", "", ""],
        ["RPT-101", "Reports", "Reports default monthly owner view", "P2", "Medium", "Manual", "Reports page open", "1. Open reports\n2. Confirm initial time range and chart state", "Reports opens in the intended owner default without broken chips or spacing.", "Reports screenshot", "Owner", "Not Run", "", "", ""],
        ["RPT-102", "Reports", "Reports chart and cards dark mode parity", "P1", "High", "Manual", "Reports page open in dark mode", "1. Toggle dark mode\n2. Inspect chart, stat cards, watch signal, and side panels", "Chart surface, labels, and cards remain readable without light leakage.", "Reports screenshot", "Owner", "Not Run", "", "", ""],
        ["INV-101", "Inventory", "Inventory live stock directory search", "P1", "High", "Manual", "Inventory page open", "1. Search by SKU or product name\n2. Clear search", "Directory filters correctly and restores the full list when cleared.", "Inventory screenshot", "Owner", "Not Run", "", "", ""],
        ["INV-102", "Inventory", "Inventory quick route pills remain styled", "P2", "Medium", "Manual", "Inventory page open", "1. Inspect quick actions such as Open Inventory and Open Orders\n2. Click each", "Actions render as shared route pills, not plain text links.", "Inventory screenshot", "Owner", "Not Run", "", "", ""],
        ["POSD-101", "POS Dashboard", "Catalog studio draft lifecycle", "P1", "High", "Manual", "POS Dashboard open", "1. Edit catalog studio fields\n2. Save draft\n3. Reset draft", "Draft state changes accurately and reset restores the baseline.", "POS Dashboard screenshot", "Owner", "Not Run", "", "", ""],
        ["POSD-102", "POS Dashboard", "Reorder planner selection state", "P2", "Medium", "Manual", "POS Dashboard open with reorder planner", "1. Select reorder lines\n2. Export or clear selection", "Selection counts and enabled actions track the live queue correctly.", "POS Dashboard screenshot", "Owner", "Not Run", "", "", ""],
        ["POS-101", "POS", "POS category selector interaction", "P2", "Medium", "Manual", "POS open", "1. Open category selector\n2. Choose multiple categories one at a time", "Owner can use a controlled selector instead of an uncontrolled row of links.", "POS screenshot", "Owner", "Not Run", "", "", ""],
        ["POS-102", "POS", "POS customer assignment to ticket", "P1", "High", "Manual", "POS open and customers seeded", "1. Add items\n2. Select a named customer\n3. Review pricing and summary", "Ticket recognizes the customer correctly and updates pricing where applicable.", "POS screenshot", "Owner", "Not Run", "", "", ""],
        ["POS-103", "POS", "POS cart math and totals", "P1", "Critical", "Manual", "POS open", "1. Add multiple products\n2. Change quantities\n3. Remove one line", "Subtotal, tax, and total remain accurate throughout edits.", "POS screenshot", "Owner", "Not Run", "", "", ""],
        ["POS-104", "POS", "POS manual receipt reprint", "P2", "Medium", "Manual", "One completed sale exists in current session", "1. Complete sale\n2. Use Print Receipt action again", "Owner can re-open the receipt print flow without resubmitting the sale.", "Receipt evidence", "Owner", "Not Run", "", "", ""],
        ["ORD-101", "Orders", "Orders refund route opens from ledger", "P1", "High", "Manual", "Orders page open with paid order visible", "1. Use Refund action on a paid order", "Owner is routed to the refund desk for the selected order.", "Orders/refund screenshot", "Owner", "Not Run", "", "", ""],
        ["ORD-102", "Orders", "Orders settlement and status chips", "P2", "Medium", "Manual", "Orders page open", "1. Inspect paid, declined, and pending rows", "Status chips use the correct owner-safe colors and remain readable in light and dark mode.", "Orders screenshot", "Owner", "Not Run", "", "", ""],
        ["REF-101", "Refunds", "Refund draft validation", "P1", "High", "Manual", "Refund desk open", "1. Select paid order\n2. Leave required narrative blank\n3. Attempt submit", "Refund report remains blocked until required draft fields are complete.", "Refund screenshot", "Owner", "Not Run", "", "", ""],
        ["REF-102", "Refunds", "Refund draft reset", "P2", "Medium", "Manual", "Refund desk open with draft fields entered", "1. Enter draft details\n2. Click Reset Draft", "Draft fields clear back to the base state without breaking the queue or selected order.", "Refund screenshot", "Owner", "Not Run", "", "", ""],
        ["REF-103", "Refunds", "Refund approve path with correct owner PIN", "P1", "Critical", "Manual", "Refund request waiting for decision", "1. Select queued request\n2. Enter valid owner PIN\n3. Approve", "Decision succeeds, queue updates, and the sale reflects the approved refund state.", "Refund screenshot", "Owner", "Not Run", "", "", ""],
        ["REF-104", "Refunds", "Refund reject path", "P2", "Medium", "Manual", "Refund request waiting for decision", "1. Select queued request\n2. Enter decision note\n3. Reject", "Request leaves the queue with a rejected state and retains audit notes.", "Refund screenshot", "Owner", "Not Run", "", "", ""],
        ["CUS-101", "Customers", "Customer list search and navigation", "P1", "High", "Manual", "Customers page open", "1. Search a known customer\n2. Open their record\n3. Return to list", "Search finds the customer and routing remains stable both directions.", "Customer screenshot", "Owner", "Not Run", "", "", ""],
        ["CUS-102", "Customers", "Customer profile save and reset behavior", "P2", "Medium", "Manual", "Customer record open", "1. Edit profile fields\n2. Use Reset Changes\n3. Edit again and save", "Reset restores baseline and save persists the intended edits.", "Customer screenshot", "Owner", "Not Run", "", "", ""],
        ["CUS-103", "Customers", "Loyalty issue toggle does not require note", "P1", "High", "Manual", "Customer record open", "1. Enable loyalty issuance\n2. Do not enter optional notes\n3. Save", "Loyalty enrollment works without forcing a note field.", "Customer screenshot", "Owner", "Not Run", "", "", ""],
        ["CUS-104", "Customers", "Start checkout from customer record", "P2", "Medium", "Manual", "Customer record open", "1. Click Start Checkout", "Owner is routed into POS with customer context preserved.", "POS screenshot", "Owner", "Not Run", "", "", ""],
        ["SUP-101", "Suppliers", "Supplier list search and select action", "P2", "Medium", "Manual", "Suppliers page open", "1. Search for a supplier\n2. Use Select action", "Supplier actions stay within owner workflows and remain styled as pills.", "Suppliers screenshot", "Owner", "Not Run", "", "", ""],
        ["SUP-102", "Suppliers", "Supplier studio save and reset", "P2", "Medium", "Manual", "Supplier Studio open", "1. Edit supplier fields\n2. Save\n3. Reset to baseline", "Draft lifecycle is stable and reset does not delete unrelated data.", "Supplier studio screenshot", "Owner", "Not Run", "", "", ""],
        ["POB-101", "Purchase Orders", "Purchase order builder draft lifecycle", "P2", "Medium", "Manual", "Purchase Order Builder open", "1. Add lines\n2. Save draft\n3. Reset draft", "Builder accurately tracks loaded package versus edited draft.", "PO builder screenshot", "Owner", "Not Run", "", "", ""],
        ["USR-101", "User Management", "User list filter pills", "P2", "Medium", "Manual", "User management page open", "1. Use All staff, Pending, Cashiers, Inventory filters", "Filters stay styled as pills and update the table correctly.", "Users screenshot", "Owner", "Not Run", "", "", ""],
        ["USR-102", "User Management", "Create staff record flow", "P1", "High", "Manual", "User management page open", "1. Click Invite User\n2. Fill required fields\n3. Save draft", "Create Staff Record opens and owner can save a new record without routing drift.", "Create staff screenshot", "Owner", "Not Run", "", "", ""],
        ["USR-103", "User Management", "Staff record tabs", "P1", "High", "Manual", "Existing staff record open", "1. Open Security\n2. Open Access\n3. Open Profile\n4. Open Audit", "Each tab renders the intended owner section and does not route to another module.", "Staff record screenshot", "Owner", "Not Run", "", "", ""],
        ["USR-104", "User Management", "Status selector colors", "P2", "Medium", "Manual", "Existing staff record open", "1. Change between Pending Approval, Active, and Inactive", "Selected state colors match the actual state and do not stay green for inactive or pending.", "Staff record screenshot", "Owner", "Not Run", "", "", ""],
        ["USR-105", "User Management", "Create staff record dark mode", "P1", "High", "Manual", "Create Staff Record page open in dark mode", "1. Toggle dark mode\n2. Inspect form cards, schedule, and snapshot panels", "No nested white cards leak into the page in dark mode.", "Dark mode screenshot", "Owner", "Not Run", "", "", ""],
        ["SET-101", "Settings", "Settings rail visual parity", "P2", "Medium", "Manual", "Settings page open", "1. Compare settings rail cards to sidebar treatment", "Rail icons and active item visual weight align with the sidebar design system.", "Settings screenshot", "Owner", "Not Run", "", "", ""],
        ["SET-102", "Settings", "Daily summary preview", "P2", "Medium", "Manual", "Settings page open with summary feature available", "1. Open daily summary preview", "Preview endpoint responds and UI remains stable.", "Settings screenshot", "Owner", "Not Run", "", "", ""],
        ["SET-103", "Settings", "Biometric device management", "P2", "Medium", "Manual", "Settings page open on owner device", "1. Review biometric access section\n2. Inspect registered device state", "Passkey/device state is readable and owner controls are present.", "Settings screenshot", "Owner", "Not Run", "", "", ""],
        ["UI-101", "Workspace", "Browser zoom 125 percent", "P1", "High", "Manual", "Owner signed in", "1. Set browser zoom to 125%\n2. Navigate dashboard, settings, users", "Sidebar, command bars, and page actions remain usable without clipping.", "Zoom screenshot", "Owner", "Not Run", "", "", ""],
        ["UI-102", "Workspace", "Browser zoom 150 percent", "P2", "Medium", "Manual", "Owner signed in", "1. Set browser zoom to 150%\n2. Navigate key owner routes", "Critical controls remain reachable and readable.", "Zoom screenshot", "Owner", "Not Run", "", "", ""],
    ]

    api_columns = [
        ("ID", 12), ("Area", 18), ("Control / Endpoint", 30), ("Priority", 10), ("Severity", 12),
        ("Preconditions", 28), ("Steps", 42), ("Expected Result", 42), ("Evidence", 24),
        ("Assigned To", 16), ("Status", 14), ("Notes", 24),
    ]
    api_rows = [
        [heading for heading, _ in api_columns],
        ["SEC-001", "Auth", "GET /api/auth/me authenticated", "P1", "Critical", "Owner session exists", "1. Call /api/auth/me with valid session", "Returns current owner identity and role.", "CLI or API capture", "Backend", "Not Run", ""],
        ["SEC-002", "Auth", "GET /api/sales unauthenticated", "P1", "High", "No auth token supplied", "1. Call /api/sales without auth", "Request is rejected with 401.", "CLI output", "Backend", "Not Run", ""],
        ["SEC-003", "Host Validation", "Invalid host rejection", "P1", "High", "Server running with host allowlist", "1. Send request with malicious Host header", "Request is rejected with host-not-allowed posture.", "CLI output", "Backend", "Not Run", ""],
        ["SEC-004", "Assistant", "GET /api/reports/owner-assistant", "P1", "High", "Authenticated owner session", "1. Call assistant bootstrap endpoint", "Returns assistant context and follow-ups for owner workspace.", "CLI output", "Backend", "Not Run", ""],
        ["SEC-005", "Assistant", "POST /api/reports/owner-assistant", "P1", "High", "Authenticated owner session", "1. Submit grounded assistant question", "Returns grounded assistant reply and suggested actions.", "CLI output", "Backend", "Not Run", ""],
        ["SEC-006", "Settings", "GET /api/settings/daily-summary/preview", "P2", "Medium", "Authenticated owner session", "1. Call daily summary preview endpoint", "Returns preview payload without server error.", "CLI output", "Backend", "Not Run", ""],
        ["SEC-007", "Notifications", "POST /api/reports/notifications/acknowledge", "P2", "Medium", "Authenticated owner session and unread notification", "1. Acknowledge a notification", "Unread state updates without breaking notification list.", "CLI output", "Backend", "Not Run", ""],
        ["SEC-008", "Sales", "POST /api/sales", "P1", "Critical", "Authenticated owner session and sale payload", "1. Submit sale payload", "Sale is created and persists with expected totals.", "CLI output", "Backend", "Not Run", ""],
        ["SEC-009", "Refunds", "POST refund request decision", "P1", "Critical", "Refund request exists", "1. Attempt refund decision without owner PIN\n2. Retry with valid owner PIN", "Decision remains blocked without the PIN and succeeds with the valid owner PIN.", "CLI output", "Backend", "Not Run", ""],
        ["SEC-010", "Readiness", "GET /api/system/health", "P1", "High", "Server running", "1. Call health endpoint on allowed host", "Returns health OK payload.", "CLI output", "Ops", "Not Run", ""],
        ["SEC-011", "Readiness", "verify:readiness", "P1", "Critical", "Local runtime seeded", "1. Run backend verify:readiness", "Readiness status is ready with zero failures.", "CLI output", "Ops", "Not Run", ""],
        ["SEC-012", "Data Integrity", "verify:data-quality", "P1", "Critical", "Reference data seeded", "1. Run backend verify:data-quality", "Reports zero issues and zero warnings.", "CLI output", "Backend", "Not Run", ""],
        ["SEC-013", "Transactions", "verify:transactions", "P1", "High", "Replica-set runtime available", "1. Run backend verify:transactions", "Native transaction support is active.", "CLI output", "Backend", "Not Run", ""],
        ["SEC-014", "Backups", "verify:backup", "P1", "High", "Live local database available", "1. Run backend verify:backup", "Snapshot is structurally valid and counts match storage.", "CLI output", "Ops", "Not Run", ""],
        ["SEC-015", "Backups", "verify:restore", "P1", "High", "Backup snapshot available", "1. Run backend verify:restore", "Restore drill matches expected collection counts.", "CLI output", "Ops", "Not Run", ""],
        ["SEC-016", "Security Config", "Auth bypass disabled", "P1", "Critical", "Local runtime seeded", "1. Run verify:readiness and inspect checks", "Readiness explicitly reports auth bypass disabled.", "CLI output", "Backend", "Not Run", ""],
    ]

    data_columns = [
        ("ID", 12), ("Area", 18), ("Scenario", 32), ("Priority", 10), ("Severity", 12),
        ("Preconditions", 28), ("Steps", 40), ("Expected Result", 40), ("Evidence", 24),
        ("Assigned To", 16), ("Status", 14), ("Notes", 24),
    ]
    data_rows = [
        [heading for heading, _ in data_columns],
        ["DAT-001", "Bootstrap", "Reference bootstrap counts", "P1", "Critical", "Local Mongo runtime available", "1. Run db:bootstrap\n2. Inspect output", "Bootstrap completes with seeded core entities present.", "CLI output", "Backend", "Not Run", ""],
        ["DAT-002", "Catalog", "Product count", "P1", "High", "Reference data seeded", "1. Verify product collection count", "Product catalog count is 50.", "CLI output", "Backend", "Not Run", ""],
        ["DAT-003", "Catalog", "Supplier count", "P1", "High", "Reference data seeded", "1. Verify supplier collection count", "Supplier count is 8.", "CLI output", "Backend", "Not Run", ""],
        ["DAT-004", "Catalog", "Customer count", "P1", "High", "Reference data seeded", "1. Verify customer collection count", "Customer count is 12.", "CLI output", "Backend", "Not Run", ""],
        ["DAT-005", "Catalog", "User count", "P1", "High", "Reference data seeded", "1. Verify user collection count", "User count is 7.", "CLI output", "Backend", "Not Run", ""],
        ["DAT-006", "Catalog", "Sales count", "P1", "High", "Reference data seeded", "1. Verify sales collection count", "Sales count is 16 before new local transactions.", "CLI output", "Backend", "Not Run", ""],
        ["DAT-007", "Inventory", "Inventory movement growth", "P2", "Medium", "Reference data seeded", "1. Receive a PO or complete a sale\n2. Compare movement count before and after", "Inventory movement count increases after business events.", "CLI output", "Backend", "Not Run", ""],
        ["DAT-008", "Customers", "Deliverable customer communications", "P2", "Medium", "Reference data seeded", "1. Call customer communications endpoint", "Deliverable customer count is returned and customers have valid contact posture.", "CLI output", "Backend", "Not Run", ""],
        ["DAT-009", "Templates", "Historical customers CSV template", "P2", "Medium", "Repo checkout available", "1. Open backend/imports/templates/historical/customers.template.csv", "Template contains owner import columns and can be used as a source file skeleton.", "Template screenshot", "QA Lead", "Not Run", ""],
        ["DAT-010", "Templates", "Historical users example CSV", "P2", "Medium", "Repo checkout available", "1. Open backend/imports/examples/historical/users.csv", "Example file shows valid column ordering for owner review.", "Template screenshot", "QA Lead", "Not Run", ""],
        ["DAT-011", "Tax", "Ontario tax mapping coverage", "P2", "Medium", "Reference catalog seeded", "1. Verify grocery and taxable items in reports/POS", "Tax posture matches expected seeded product types.", "POS or report screenshot", "Owner", "Not Run", ""],
        ["DAT-012", "Reseed Safety", "Guarded destructive reseed requires confirmation", "P2", "Medium", "CLI access available", "1. Attempt reseed without confirmation env", "Script refuses destructive reseed without explicit confirmation.", "CLI output", "Backend", "Not Run", ""],
    ]

    environment_columns = [
        ("ID", 10), ("Dimension", 20), ("Variant", 24), ("Coverage Expectation", 42),
        ("Owner", 16), ("Status", 14), ("Evidence", 24), ("Notes", 24),
    ]
    environment_rows = [
        [heading for heading, _ in environment_columns],
        ["ENV-001", "Browser", "Chrome stable", "Primary owner browser full workflow pass", "Owner", "Not Run", "Screenshots / notes", ""],
        ["ENV-002", "Browser", "Microsoft Edge", "Core owner smoke routes pass", "Owner", "Not Run", "Screenshots / notes", ""],
        ["ENV-003", "Theme", "Light mode", "No broken surfaces or unreadable text", "Owner", "Not Run", "Screenshots / notes", ""],
        ["ENV-004", "Theme", "Dark mode", "No light leakage in cards, panels, or assistant", "Owner", "Not Run", "Screenshots / notes", ""],
        ["ENV-005", "Zoom", "100 percent", "Baseline owner UI stable", "Owner", "Not Run", "Screenshots / notes", ""],
        ["ENV-006", "Zoom", "125 percent", "Sidebar and top commands remain usable", "Owner", "Not Run", "Screenshots / notes", ""],
        ["ENV-007", "Zoom", "150 percent", "Critical owner actions remain reachable", "Owner", "Not Run", "Screenshots / notes", ""],
        ["ENV-008", "Device", "Windows Hello owner device", "Fingerprint / PIN sign-in path validated", "Owner", "Not Run", "Screenshots / notes", ""],
        ["ENV-009", "Printing", "Physical printer or Save as PDF", "Receipt printing and reprint validated", "Owner", "Not Run", "Receipt evidence", ""],
        ["ENV-010", "Runtime", "Local seeded runtime", "Release, smoke, and proof checks pass", "Ops", "Not Run", "CLI output", ""],
        ["ENV-011", "Runtime", "Staging deployment", "Deployment smoke and monitoring checks pass", "Ops", "Not Run", "CLI output", ""],
    ]

    core_route_map = {
        "AUTH-001": "/login -> POST /api/auth/login",
        "AUTH-002": "/login -> POST /api/auth/passkey-login/options + verify",
        "AUTH-003": "/login -> POST /api/auth/login",
        "DASH-001": "/",
        "DASH-002": "/ -> /pos-dashboard | /reports | /terminal | /users",
        "AI-001": "Global dock -> GET /api/reports/owner-assistant",
        "AI-002": "Global dock -> POST /api/reports/owner-assistant",
        "AI-003": "Global dock -> route action state navigation",
        "SET-001": "/settings -> /api/settings/*",
        "SET-002": "/settings",
        "SET-003": "/settings -> /api/reports/notifications",
        "INV-001": "/pos-dashboard",
        "POSD-001": "/pos-dashboard/*",
        "POS-001": "/terminal -> GET /api/products",
        "POS-002": "/terminal -> POST /api/sales",
        "ORD-001": "/orders",
        "ORD-002": "/orders/refunds -> POST /api/sales/:saleId/refund-request/decision",
        "CUS-001": "/customers/:customerId",
        "CUS-002": "/customers/:customerId",
        "USR-001": "/users -> /users/staff/new | /users/staff/:userId",
        "USR-002": "/users/staff/:userId",
        "NTF-001": "Global bell -> GET/POST /api/reports/notifications*",
        "REL-001": "CLI: npm run verify:release:local",
    }
    deep_route_map = {
        "DASH-101": "/",
        "DASH-102": "/",
        "DASH-103": "/",
        "AI-101": "Global dock",
        "AI-102": "Global dock -> POST /api/reports/owner-assistant",
        "AI-103": "Global dock",
        "RPT-101": "/reports -> GET /api/reports?range=monthly",
        "RPT-102": "/reports",
        "INV-101": "/pos-dashboard",
        "INV-102": "/pos-dashboard",
        "POSD-101": "/pos-dashboard/catalog-studio",
        "POSD-102": "/pos-dashboard/reorder",
        "POS-101": "/terminal -> GET /api/products",
        "POS-102": "/terminal",
        "POS-103": "/terminal",
        "POS-104": "/terminal -> latest receipt reprint",
        "ORD-101": "/orders -> /orders/refunds",
        "ORD-102": "/orders",
        "REF-101": "/orders/refunds -> POST /api/sales/:saleId/refund-request",
        "REF-102": "/orders/refunds",
        "REF-103": "/orders/refunds -> POST /api/sales/:saleId/refund-request/decision",
        "REF-104": "/orders/refunds -> POST /api/sales/:saleId/refund-request/decision",
        "CUS-101": "/customers -> /customers/:customerId",
        "CUS-102": "/customers/:customerId",
        "CUS-103": "/customers/:customerId",
        "CUS-104": "/customers/:customerId -> /terminal",
        "SUP-101": "/suppliers",
        "SUP-102": "/suppliers/:supplierId",
        "POB-101": "/purchase-orders/new",
        "USR-101": "/users",
        "USR-102": "/users/staff/new",
        "USR-103": "/users/staff/:userId",
        "USR-104": "/users/staff/:userId",
        "USR-105": "/users/staff/new",
        "SET-101": "/settings",
        "SET-102": "/settings -> GET /api/settings/daily-summary/preview",
        "SET-103": "/settings",
        "UI-101": "Owner workspace shell",
        "UI-102": "Owner workspace shell",
    }
    release_route_map = {
        "REL-01": "CLI: npm ci",
        "REL-02": "CLI: npm audit --omit=dev",
        "REL-03": "CLI: npm run verify:release:local",
        "REL-04": "CLI: Playwright focused owner suite",
        "REL-05": "CLI: npm --prefix backend run db:bootstrap",
        "REL-06": "CLI: npm run verify:load:smoke",
        "REL-07": "CLI: npm run verify:load:proof",
        "REL-08": "Host validation / api/system/health",
        "REL-09": "CLI: verify:backup + verify:restore",
        "REL-10": "qa/AfroSpice_Test_Cases.xlsx",
    }
    non_functional_route_map = {
        "Performance": "CLI: verify:load:*",
        "Reliability": "CLI: verify:release:local",
        "Accessibility": "Dashboard, Reports, Customers, Users, Assistant",
        "Usability": "Workspace shell routes",
        "Security": "api/system/health, api/sales, refund decision",
        "Data Integrity": "CLI: verify:data-quality",
    }
    deployment_route_map = {
        "SMK-01": "/login -> /",
        "SMK-02": "Global dock -> POST /api/reports/owner-assistant",
        "SMK-03": "/settings",
        "SMK-04": "/terminal -> POST /api/sales",
        "SMK-05": "/orders/refunds",
        "SMK-06": "/customers/:customerId",
        "SMK-07": "/users/staff/:userId",
        "SMK-08": "/api/system/health + /api/system/readiness",
    }
    monitoring_route_map = {
        "MON-01": "/api/system/health + reverse proxy",
        "MON-02": "/api/reports/owner-assistant",
        "MON-03": "/api/auth/login + user access events",
        "MON-04": "/api/sales/*refund*",
        "MON-05": "/api/reports/notifications",
        "MON-06": "Mongo collections",
        "MON-07": "Backup verification",
        "MON-08": "Dashboard / Reports / Assistant / Detail pages",
    }
    environment_route_map = {
        "ENV-001": "Chrome owner flows",
        "ENV-002": "Edge owner flows",
        "ENV-003": "Workspace light mode",
        "ENV-004": "Workspace dark mode",
        "ENV-005": "100% zoom",
        "ENV-006": "125% zoom",
        "ENV-007": "150% zoom",
        "ENV-008": "/login",
        "ENV-009": "/terminal",
        "ENV-010": "CLI verification suite",
        "ENV-011": "Staging deployment routes",
    }

    core_columns, core_rows = append_route_column(core_columns, core_rows, core_route_map)
    deep_dive_columns, deep_dive_rows = append_route_column(deep_dive_columns, deep_dive_rows, deep_route_map)
    release_columns, release_rows = append_route_column(release_columns, release_rows, release_route_map)
    non_functional_columns, non_functional_rows = append_route_column(
        non_functional_columns,
        non_functional_rows,
        {row[0]: non_functional_route_map.get(row[0], non_functional_route_map.get(row[1], "N/A")) for row in non_functional_rows[1:]},
    )
    deployment_columns, deployment_rows = append_route_column(deployment_columns, deployment_rows, deployment_route_map)
    monitoring_columns, monitoring_rows = append_route_column(monitoring_columns, monitoring_rows, monitoring_route_map)
    environment_columns, environment_rows = append_route_column(environment_columns, environment_rows, environment_route_map)

    core_updates = {
        "AUTH-001": {
            "Status": "Passed",
            "Evidence": "qa/evidence/screenshots/auth-dashboard.png",
            "Actual Result": "Owner PIN sign-in completed and landed on the dashboard.",
            "Notes": "Validated in focused browser automation with owner PIN 7700 on 2026-04-07.",
        },
        "AI-001": {
            "Status": "Passed",
            "Evidence": "qa/evidence/screenshots/assistant-open.png",
            "Actual Result": "Assistant dock opened, rendered correctly, and closed/reopened cleanly during browser coverage.",
            "Notes": "Covered by owner-assistant.spec.js.",
        },
        "AI-002": {
            "Status": "Passed",
            "Evidence": "qa/evidence/screenshots/assistant-response.png",
            "Actual Result": "Grounded assistant returned a live answer and follow-up prompts refreshed.",
            "Notes": "POST /api/reports/owner-assistant returned 200 in automated coverage and owner route verification.",
        },
        "AI-003": {
            "Status": "Passed",
            "Evidence": "qa/evidence/logs/verify-release-local.log",
            "Actual Result": "Assistant follow-up action navigated to a destination route and rendered the action banner.",
            "Notes": "Covered by owner-assistant.spec.js action-button path.",
        },
        "SET-002": {
            "Status": "Passed",
            "Evidence": "qa/evidence/screenshots/settings-dark-mode.png",
            "Actual Result": "Theme toggle applied dark mode and the workspace shell stayed on dark surfaces.",
            "Notes": "Validated in production-surfaces.spec.js and captured in settings evidence screenshot.",
        },
        "ORD-002": {
            "Status": "Passed",
            "Evidence": "qa/evidence/screenshots/refund-desk-ready.png",
            "Actual Result": "Refund desk kept owner approval locked behind the current owner PIN path.",
            "Notes": "UI lock guidance verified in browser coverage; backend decision endpoint verified in owner route E2E.",
        },
        "USR-001": {
            "Status": "Passed",
            "Evidence": "qa/evidence/screenshots/users-create-staff.png | qa/evidence/screenshots/users-staff-security.png",
            "Actual Result": "Invite opened Create Staff Record and View opened the staff security record instead of inventory.",
            "Notes": "Validated by route-integrity.spec.js and production-surfaces.spec.js.",
        },
        "REL-001": {
            "Status": "Passed",
            "Evidence": "qa/evidence/logs/verify-release-local.log",
            "Actual Result": "Local release gate completed successfully with no blocking failures.",
            "Notes": "Run completed on 2026-04-07 after workbook evidence refresh.",
        },
    }

    deep_dive_updates = {
        "AI-103": {
            "Status": "Passed",
            "Evidence": "qa/evidence/screenshots/settings-dark-mode.png",
            "Actual Result": "Assistant remained usable after dark mode was enabled and captured under the dark workspace shell.",
            "Notes": "Validated during screenshot capture after dark mode toggle.",
        },
        "ORD-101": {
            "Status": "Passed",
            "Evidence": "qa/evidence/screenshots/refund-desk-ready.png",
            "Actual Result": "Refund action routed from orders into the refund desk.",
            "Notes": "Validated in route-integrity browser coverage.",
        },
        "REF-101": {
            "Status": "Passed",
            "Evidence": "qa/evidence/screenshots/refund-desk-ready.png",
            "Actual Result": "Refund draft became actionable only after required report fields were entered.",
            "Notes": "Validated in production-surfaces.spec.js by checking Idle -> Ready transition.",
        },
        "REF-102": {
            "Status": "Passed",
            "Evidence": "qa/evidence/screenshots/refund-desk-ready.png",
            "Actual Result": "Reset Draft returned the refund form to its baseline state.",
            "Notes": "Validated in production-surfaces.spec.js reset path.",
        },
        "USR-102": {
            "Status": "Passed",
            "Evidence": "qa/evidence/screenshots/users-create-staff.png",
            "Actual Result": "Create Staff Record opened correctly from the owner workflow.",
            "Notes": "Captured after browser automation opened /users/staff/new.",
        },
        "USR-103": {
            "Status": "Passed",
            "Evidence": "qa/evidence/screenshots/users-staff-security.png",
            "Actual Result": "Staff View opened on the security tab and stayed inside the user management module.",
            "Notes": "Validated by route-integrity and production-surfaces browser coverage.",
        },
        "USR-105": {
            "Status": "Passed",
            "Evidence": "qa/evidence/screenshots/settings-dark-mode.png | qa/evidence/screenshots/users-create-staff.png",
            "Actual Result": "Dark theme remained stable across owner create-staff capture flows.",
            "Notes": "Create Staff Record was captured during the same dark-mode session used for evidence refresh.",
        },
    }

    api_updates = {
        "SEC-001": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Owner route E2E verified GET /api/auth/me -> 200."},
        "SEC-002": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Release log includes unauthenticated /api/sales rejection -> 401."},
        "SEC-003": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Release log includes host-not-allowed rejection for malicious.example.com."},
        "SEC-004": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Owner workflow verification hit assistant bootstrap endpoint -> 200."},
        "SEC-005": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Owner workflow verification hit assistant POST endpoint -> 200."},
        "SEC-006": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Owner workflow verification hit daily-summary preview endpoint -> 200."},
        "SEC-007": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Owner workflow verification acknowledged notifications successfully."},
        "SEC-008": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Owner workflow verification created a sale -> 201."},
        "SEC-010": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Health endpoint returned success in release verification."},
        "SEC-011": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "verify:readiness returned status ready with zero failures."},
        "SEC-012": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "verify:data-quality reported 0 issues and 0 warnings."},
        "SEC-013": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "verify:transactions confirmed native transaction support."},
        "SEC-014": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "verify:backup passed and counts matched storage."},
        "SEC-015": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "verify:restore restored into a temp DB and matched counts."},
        "SEC-016": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Readiness explicitly reported authentication bypass disabled."},
    }

    data_updates = {
        "DAT-001": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Local runtime was reseeded successfully before final close-testing."},
        "DAT-002": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Runtime verification reported 50 products."},
        "DAT-003": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Runtime verification reported 8 suppliers."},
        "DAT-004": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Runtime verification reported 12 customers."},
        "DAT-005": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Runtime verification reported 7 users."},
        "DAT-006": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Runtime verification reported 16 sales."},
        "DAT-008": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Owner route verification successfully hit customer communications data for a created customer."},
    }

    environment_updates = {
        "ENV-002": {"Status": "Passed", "Evidence": "qa/evidence/screenshots/auth-dashboard.png", "Notes": "Focused browser suite and screenshot capture ran through the Windows Edge channel."},
        "ENV-004": {"Status": "Passed", "Evidence": "qa/evidence/screenshots/settings-dark-mode.png | qa/evidence/screenshots/customer-profile-dark.png", "Notes": "Dark mode screenshot evidence captured for settings and customer detail."},
        "ENV-010": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log | qa/evidence/logs/verify-load-smoke.log | qa/evidence/logs/verify-load-proof.log", "Notes": "Local seeded runtime passed release, smoke, and proof checks."},
    }

    release_updates = {
        "REL-01": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Dependencies were reinstalled and release verification ran cleanly."},
        "REL-02": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Production audit checks were previously run at 0 vulnerabilities and no new issues surfaced."},
        "REL-03": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Release gate passed on 2026-04-07."},
        "REL-05": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Reference data was present and runtime counts matched expected seeded coverage."},
        "REL-06": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-load-smoke.log", "Notes": "Smoke load completed with all 200 responses."},
        "REL-07": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-load-proof.log", "Notes": "Proof load completed with all 200 responses."},
        "REL-08": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Host validation rejected an invalid host during owner workflow verification."},
        "REL-09": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Backup and restore drill both passed in the release log."},
        "REL-10": {"Status": "Passed", "Evidence": "qa/AfroSpice_Test_Cases.xlsx", "Notes": "Workbook regenerated with evidence, traceability, and signoff sheets."},
    }

    non_functional_updates = {
        "Performance": {"Status": "Passed", "Notes": "Load smoke and proof logs captured under qa/evidence/logs."},
        "Reliability": {"Status": "Passed", "Notes": "Release gate passed on the refreshed local runtime."},
        "Data Integrity": {"Status": "Passed", "Notes": "Data quality verification returned 0 issues and 0 warnings."},
    }

    deployment_updates = {
        "SMK-01": {"Status": "Passed", "Evidence": "qa/evidence/screenshots/auth-dashboard.png", "Notes": "Local owner sign-in smoke completed successfully."},
        "SMK-02": {"Status": "Passed", "Evidence": "qa/evidence/screenshots/assistant-response.png", "Notes": "Assistant smoke completed with grounded response evidence."},
        "SMK-03": {"Status": "Passed", "Evidence": "qa/evidence/screenshots/settings-dark-mode.png", "Notes": "Settings page rendered and dark mode persisted during evidence capture."},
        "SMK-05": {"Status": "Passed", "Evidence": "qa/evidence/screenshots/refund-desk-ready.png", "Notes": "Refund desk smoke completed locally."},
        "SMK-06": {"Status": "Passed", "Evidence": "qa/evidence/screenshots/customer-profile-dark.png", "Notes": "Customer detail smoke completed locally."},
        "SMK-07": {"Status": "Passed", "Evidence": "qa/evidence/screenshots/users-staff-security.png", "Notes": "Staff record smoke completed locally."},
        "SMK-08": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Health/readiness checks passed during release verification."},
    }

    monitoring_updates = {
        "MON-06": {"Status": "Passed", "Notes": "Runtime verification captured current collection counts after reseed."},
        "MON-07": {"Status": "Passed", "Evidence": "qa/evidence/logs/verify-release-local.log", "Notes": "Backup validation and restore drill both passed."},
        "MON-08": {"Status": "Passed", "Evidence": "qa/evidence/screenshots/settings-dark-mode.png | qa/evidence/screenshots/customer-profile-dark.png", "Notes": "UI drift evidence refreshed for dark mode and owner detail surfaces."},
    }

    core_rows = apply_row_updates(core_columns, core_rows, core_updates)
    deep_dive_rows = apply_row_updates(deep_dive_columns, deep_dive_rows, deep_dive_updates)
    api_rows = apply_row_updates(api_columns, api_rows, api_updates)
    data_rows = apply_row_updates(data_columns, data_rows, data_updates)
    environment_rows = apply_row_updates(environment_columns, environment_rows, environment_updates)
    release_rows = apply_row_updates(release_columns, release_rows, release_updates)
    non_functional_rows = apply_row_updates(non_functional_columns, non_functional_rows, non_functional_updates)
    deployment_rows = apply_row_updates(deployment_columns, deployment_rows, deployment_updates)
    monitoring_rows = apply_row_updates(monitoring_columns, monitoring_rows, monitoring_updates)

    unit_columns = [
        ("Test ID", 14),
        ("Layer", 12),
        ("Area", 18),
        ("Test File / Command", 52),
        ("Expected Result", 44),
        ("Evidence", 34),
        ("Assigned To", 16),
        ("Status", 14),
        ("Notes", 34),
    ]
    unit_rows = [
        [heading for heading, _ in unit_columns],
        ["UT-001", "Unit", "ML Engine", "backend/tests/ml_engine/test_anomaly.py", "Anomaly scoring stays deterministic for known fixtures.", "qa/evidence/logs/pytest-unit.log", "Backend", "Passed", "Executed with pytest on 2026-04-07."],
        ["UT-002", "Unit", "ML Engine", "backend/tests/ml_engine/test_dates.py", "Date normalization and parsing rules stay stable.", "qa/evidence/logs/pytest-unit.log", "Backend", "Passed", "Executed with pytest on 2026-04-07."],
        ["UT-003", "Unit", "ML Engine", "backend/tests/ml_engine/test_forecasting.py", "Forecast helpers produce expected shape and math outputs.", "qa/evidence/logs/pytest-unit.log", "Backend", "Passed", "Executed with pytest on 2026-04-07."],
        ["UT-004", "Unit", "ML Engine", "backend/tests/ml_engine/test_inventory_risk.py", "Inventory risk calculations hold expected thresholds.", "qa/evidence/logs/pytest-unit.log", "Backend", "Passed", "Executed with pytest on 2026-04-07."],
        ["UT-005", "Unit", "ML Engine", "backend/tests/ml_engine/test_payload.py", "Model payload adapters keep expected schema contracts.", "qa/evidence/logs/pytest-unit.log", "Backend", "Passed", "Executed with pytest on 2026-04-07."],
        ["UT-006", "Unit", "ML Engine", "backend/tests/ml_engine/test_supplier.py", "Supplier scoring helpers remain stable for seeded fixtures.", "qa/evidence/logs/pytest-unit.log", "Backend", "Passed", "Executed with pytest on 2026-04-07."],
        ["UT-007", "Unit", "ML Engine", "backend/tests/ml_engine/test_utils.py", "Shared utility helpers return expected values and guards.", "qa/evidence/logs/pytest-unit.log", "Backend", "Passed", "Executed with pytest on 2026-04-07."],
        ["UT-008", "Unit", "ML Engine", "python -m pytest backend/tests/ml_engine -q", "Backend ML unit suite completes with all tests green.", "qa/evidence/logs/pytest-unit.log", "Backend", "Passed", "20 passed, 1 warning."],
        ["UT-009", "Unit", "Frontend", "No dedicated Vitest/Jest suite present yet", "Critical shared hooks/components should have isolated unit coverage.", "", "Frontend", "Not Run", "Current gap: frontend leans on browser E2E instead of dedicated unit tests."],
    ]

    integration_columns = [
        ("Test ID", 14),
        ("Layer", 12),
        ("Area", 18),
        ("Command / Route", 54),
        ("Expected Result", 44),
        ("Evidence", 34),
        ("Assigned To", 16),
        ("Status", 14),
        ("Notes", 34),
    ]
    integration_rows = [
        [heading for heading, _ in integration_columns],
        ["IT-001", "Integration", "Runtime", "npm.cmd run verify:release:local", "Cross-layer release verification completes successfully.", "qa/evidence/logs/verify-release-local.log", "Backend", "Passed", "Executed on 2026-04-07."],
        ["IT-002", "Integration", "Data Quality", "npm.cmd run verify:data-quality", "Reference data validates with zero issues and zero warnings.", "qa/evidence/logs/verify-release-local.log", "Backend", "Passed", "Captured inside release log."],
        ["IT-003", "Integration", "Transactions", "npm.cmd run verify:transactions", "Runtime reports transaction readiness with no blocking failures.", "qa/evidence/logs/verify-release-local.log", "Backend", "Passed", "Captured inside release log."],
        ["IT-004", "Integration", "Owner Workflows", "npm.cmd run verify:owner:e2e", "Owner flow endpoints respond correctly across auth, assistant, refunds, and settings.", "qa/evidence/logs/verify-release-local.log", "Backend", "Passed", "Captured inside release log."],
        ["IT-005", "Integration", "Backup", "npm.cmd run verify:backup", "Backup snapshot completes and counts match source collections.", "qa/evidence/logs/verify-release-local.log", "Ops", "Passed", "Captured inside release log."],
        ["IT-006", "Integration", "Restore", "npm.cmd run verify:restore", "Restore drill rebuilds a temp database and matches counts.", "qa/evidence/logs/verify-release-local.log", "Ops", "Passed", "Captured inside release log."],
        ["IT-007", "Integration", "Security Audits", "npm.cmd audit --omit=dev | frontend audit | backend audit", "Package-level production audits report zero vulnerabilities.", "qa/evidence/logs/audit-root.log | qa/evidence/logs/audit-frontend.log | qa/evidence/logs/audit-backend.log", "Ops", "Passed", "Audit logs captured on 2026-04-07."],
        ["IT-008", "Integration", "Load", "npm.cmd run verify:load:smoke + npm.cmd run verify:load:proof", "Smoke and proof load checks complete without non-200 responses.", "qa/evidence/logs/verify-load-smoke.log | qa/evidence/logs/verify-load-proof.log", "Ops", "Passed", "Local performance proof completed."],
    ]

    e2e_columns = [
        ("Test ID", 14),
        ("Layer", 12),
        ("Area", 18),
        ("Spec / Route", 56),
        ("Expected Result", 44),
        ("Evidence", 34),
        ("Assigned To", 16),
        ("Status", 14),
        ("Notes", 34),
    ]
    e2e_rows = [
        [heading for heading, _ in e2e_columns],
        ["E2E-001", "E2E", "Theme", "frontend/e2e/theme-bootstrap.spec.js", "Dark theme bootstrap applies before hydration.", "qa/evidence/logs/e2e-owner-suite.log", "Frontend", "Passed", "Executed in focused owner suite on 2026-04-07."],
        ["E2E-002", "E2E", "Routes", "frontend/e2e/workspace-routes.spec.js", "Owner can navigate production-critical routes without shell regressions.", "qa/evidence/logs/e2e-owner-suite.log", "Frontend", "Passed", "Executed in focused owner suite on 2026-04-07."],
        ["E2E-003", "E2E", "Routing Integrity", "frontend/e2e/route-integrity.spec.js", "Invite, view, and refund actions land on the correct routes.", "qa/evidence/logs/e2e-owner-suite.log", "Frontend", "Passed", "Executed in focused owner suite on 2026-04-07."],
        ["E2E-004", "E2E", "Critical Surfaces", "frontend/e2e/production-surfaces.spec.js", "Owner-critical screens expose the refined controls and layouts.", "qa/evidence/logs/e2e-owner-suite.log", "Frontend", "Passed", "Executed in focused owner suite on 2026-04-07."],
        ["E2E-005", "E2E", "Assistant", "frontend/e2e/owner-assistant.spec.js", "Owner can sign in and use the grounded assistant successfully.", "qa/evidence/logs/e2e-owner-suite.log", "Frontend", "Passed", "Executed in focused owner suite on 2026-04-07."],
        ["E2E-006", "E2E", "Printer / Device", "Manual browser + printer validation", "Receipt dialog, layout, and device behavior are validated on the actual owner device.", "", "Owner", "Not Run", "Still requires real printer/device confirmation."],
    ]

    traceability_columns = [
        ("Test ID", 14), ("Module", 18), ("Route / Endpoint", 34), ("Primary Source Files", 62), ("Verification Type", 18), ("Notes", 24),
    ]
    traceability_rows = [
        [heading for heading, _ in traceability_columns],
        ["AUTH-001", "Authentication", "/login + /api/auth/login", "frontend/src/components/pages/Login.jsx | backend/src/routes/authRoutes.js | backend/src/controllers/authController.js", "Manual + API", "Owner PIN sign-in"],
        ["AI-002", "Assistant", "/api/reports/owner-assistant", "frontend/src/components/OwnerAssistantDock.jsx | backend/src/routes/reportRoutes.js | backend/src/controllers/reportController.js | backend/src/services/reportService.js", "Manual + Automated", "Grounded assistant reply"],
        ["SET-001", "Settings", "/settings + /api/settings/*", "frontend/src/components/pages/Settings.jsx | frontend/src/hooks/useWorkspaceSettings.js | backend/src/routes/settingsRoutes.js", "Manual", "Settings persistence"],
        ["POS-002", "POS", "/terminal + /api/sales", "frontend/src/components/pages/POS.jsx | backend/src/routes/salesRoutes.js | backend/src/controllers/salesController.js", "Manual", "Checkout and receipt print"],
        ["ORD-002", "Refunds", "/orders/refunds + refund decision endpoint", "frontend/src/components/pages/RefundDesk.jsx | frontend/src/components/pages/Orders.jsx | backend/src/routes/salesRoutes.js | backend/src/controllers/salesController.js", "Manual + Automated", "Owner PIN approval path"],
        ["CUS-001", "Customers", "/customers/:customerId", "frontend/src/components/pages/Customers.jsx | frontend/src/components/pages/CustomerProfile.jsx | backend/src/routes/customerRoutes.js", "Manual", "Detail page parity"],
        ["USR-001", "User Management", "/users + /users/staff/:userId", "frontend/src/components/pages/Users.jsx | frontend/src/components/pages/UserManagementDesk.jsx | backend/src/routes/userRoutes.js", "Manual + Automated", "Invite and view routing"],
        ["REL-001", "Release", "CLI verification suite", "scripts/verify-release.cjs | backend/scripts/verify-runtime.js | backend/scripts/verify-data-quality.js | backend/scripts/verify-owner-workflows.js", "Automated", "Release gate"],
        ["SMK-08", "Readiness", "/api/system/health + /api/system/readiness", "backend/src/routes/systemRoutes.js | backend/src/services/systemService.js", "Manual + CLI", "Go-live runtime checks"],
    ]

    signoff_columns = [
        ("Role", 18), ("Owner Name", 24), ("Scope", 44), ("Status", 18), ("Date", 18), ("Approval Notes", 36),
    ]
    signoff_rows = [
        [heading for heading, _ in signoff_columns],
        ["Owner", "", "Business workflows, dashboard, POS, refunds, customers, settings", "Pending", "", ""],
        ["QA Lead", "", "UAT execution, defect triage, regression completeness", "Pending", "", ""],
        ["Frontend", "", "UI parity, dark mode, routing, assistant shell", "Pending", "", ""],
        ["Backend", "", "API, data integrity, refunds, auth, readiness", "Pending", "", ""],
        ["Ops", "", "Load checks, backup/restore, monitoring, deployment smoke", "Pending", "", ""],
        ["Final Go-Live Decision", "", "All blocking items closed and signoff complete", "Pending", "", ""],
    ]

    bug_columns = [
        ("Bug ID", 12), ("Title", 28), ("Source Sheet", 20), ("Linked Test ID", 16),
        ("Module", 18), ("Priority", 10), ("Severity", 12), ("Environment", 24),
        ("Assigned To", 16), ("Status", 14), ("Steps To Reproduce", 38),
        ("Expected", 26), ("Actual", 26), ("Evidence", 24), ("Notes", 24),
    ]
    bug_rows = [
        [heading for heading, _ in bug_columns],
        ["BUG-001", "Example placeholder", "Core Test Cases", "AI-003", "Assistant", "P2", "Medium", "Local / Staging / Production", "QA Lead", "Open", "Replace this row with a real defect when testing begins.", "Expected owner workflow remains usable.", "Observed defect summary goes here.", "Screenshot or log path", "Delete this placeholder row before final handoff."],
    ]

    return [
        Sheet("Overview", overview_columns, overview_rows, [], []),
        Sheet("Test Strategy", test_strategy_columns, test_strategy_rows, [], []),
        Sheet("Core Test Cases", core_columns, core_rows, [{"range": "D2:D400", "formula": priorities}, {"range": "E2:E400", "formula": severities}, {"range": "K2:K400", "formula": common_assignees}, {"range": "L2:L400", "formula": uat_statuses}], uat_status_rules("L", 2, 400)),
        Sheet("Owner Deep Dive", deep_dive_columns, deep_dive_rows, [{"range": "D2:D500", "formula": priorities}, {"range": "E2:E500", "formula": severities}, {"range": "K2:K500", "formula": common_assignees}, {"range": "L2:L500", "formula": uat_statuses}], uat_status_rules("L", 2, 500)),
        Sheet("API & Security", api_columns, api_rows, [{"range": "D2:D300", "formula": priorities}, {"range": "E2:E300", "formula": severities}, {"range": "J2:J300", "formula": common_assignees}, {"range": "K2:K300", "formula": uat_statuses}], uat_status_rules("K", 2, 300)),
        Sheet("Data & Imports", data_columns, data_rows, [{"range": "D2:D250", "formula": priorities}, {"range": "E2:E250", "formula": severities}, {"range": "J2:J250", "formula": common_assignees}, {"range": "K2:K250", "formula": uat_statuses}], uat_status_rules("K", 2, 250)),
        Sheet("Unit Tests", unit_columns, unit_rows, [{"range": "G2:G200", "formula": common_assignees}, {"range": "H2:H200", "formula": uat_statuses}], uat_status_rules("H", 2, 200)),
        Sheet("Integration Tests", integration_columns, integration_rows, [{"range": "G2:G200", "formula": common_assignees}, {"range": "H2:H200", "formula": uat_statuses}], uat_status_rules("H", 2, 200)),
        Sheet("E2E Automation", e2e_columns, e2e_rows, [{"range": "G2:G200", "formula": common_assignees}, {"range": "H2:H200", "formula": uat_statuses}], uat_status_rules("H", 2, 200)),
        Sheet("Environment Matrix", environment_columns, environment_rows, [{"range": "E2:E200", "formula": common_assignees}, {"range": "F2:F200", "formula": uat_statuses}], uat_status_rules("F", 2, 200)),
        Sheet("Release Checklist", release_columns, release_rows, [{"range": "D2:D200", "formula": common_assignees}, {"range": "F2:F200", "formula": severities}, {"range": "G2:G200", "formula": uat_statuses}], uat_status_rules("G", 2, 200)),
        Sheet("Regression Matrix", regression_columns, regression_rows, [], []),
        Sheet("Non-Functional", non_functional_columns, non_functional_rows, [{"range": "E2:E200", "formula": uat_statuses}], uat_status_rules("E", 2, 200)),
        Sheet("Deployment Smoke", deployment_columns, deployment_rows, [{"range": "F2:F200", "formula": common_assignees}, {"range": "G2:G200", "formula": uat_statuses}], uat_status_rules("G", 2, 200)),
        Sheet("Monitoring Checks", monitoring_columns, monitoring_rows, [{"range": "F2:F200", "formula": common_assignees}, {"range": "G2:G200", "formula": uat_statuses}], uat_status_rules("G", 2, 200)),
        Sheet("Source Traceability", traceability_columns, traceability_rows, [], []),
        Sheet("Go-Live Signoff", signoff_columns, signoff_rows, [{"range": "D2:D20", "formula": '"Pending,Approved,Rejected,Blocked"'}], [{"range": "D2:D20", "rules": [{"dxfId": 6, "formula": 'EXACT($D2,"Approved")'}, {"dxfId": 1, "formula": 'EXACT($D2,"Rejected")'}, {"dxfId": 2, "formula": 'EXACT($D2,"Blocked")'}, {"dxfId": 3, "formula": 'EXACT($D2,"Pending")'}]}]),
        Sheet("Bug Log", bug_columns, bug_rows, [{"range": "F2:F400", "formula": priorities}, {"range": "G2:G400", "formula": severities}, {"range": "I2:I400", "formula": common_assignees}, {"range": "J2:J400", "formula": bug_statuses}], bug_status_rules("J", 2, 400)),
    ]


def write_workbook(sheets: list[Sheet]) -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUTPUT_PATH, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", build_content_types_xml(len(sheets)))
        archive.writestr("_rels/.rels", build_root_rels_xml())
        archive.writestr("docProps/core.xml", build_core_xml())
        archive.writestr("docProps/app.xml", build_app_xml(sheets))
        archive.writestr("xl/workbook.xml", build_workbook_xml(sheets))
        archive.writestr("xl/_rels/workbook.xml.rels", build_workbook_rels_xml(len(sheets)))
        archive.writestr("xl/styles.xml", build_styles_xml())
        for index, sheet in enumerate(sheets, start=1):
            archive.writestr(f"xl/worksheets/sheet{index}.xml", build_sheet_xml(sheet))


def sheet_to_dict(sheet: Sheet) -> dict:
    return {
        "name": sheet.name,
        "columns": [{"label": label, "width": width} for label, width in sheet.columns],
        "rows": sheet.rows,
        "validations": sheet.validations,
        "conditional_formats": sheet.conditional_formats,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="print workbook definition as JSON")
    args = parser.parse_args()
    sheets = make_sheets()
    if args.json:
        print(json.dumps({"output_path": str(OUTPUT_PATH), "sheets": [sheet_to_dict(sheet) for sheet in sheets]}, indent=2))
        return
    write_workbook(sheets)
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
