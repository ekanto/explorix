# Explorix metric definitions

Every dashboard, report, and export value is computed at request time from persisted records.
`GET /api/projects/{id}/reports/dashboard`, implemented in `apps/server/src/modules/reports.ts`, is the single source of truth. Each response includes these definitions under `definitions`, and the UI shows them as tooltips.

There are two kinds of value:

- **Measured:** derived from tracked timestamps, statuses, and results.
- **Estimate:** derived from user-entered values such as timeboxes. The UI labels estimates explicitly.

## Filters

All metrics accept these optional filters:

| Filter | Effect |
| --- | --- |
| `milestoneId` | Sessions/charters/runs assigned to the milestone. Findings are filtered through their session's milestone. |
| `testerId` | Sessions where the user is the tester; findings they authored; charters they are assigned to; run items assigned to them. |
| `from`, `to` | Record creation date (inclusive; `to` covers the whole day). Automation runs are filtered by `startedAt`. |

Archived charters and archived sessions are always excluded.
Session status groups:

| Group | Statuses |
| --- | --- |
| Started | Everything except Draft |
| Active | In progress, Paused, Changes requested |
| Completed | Completed, In review, Approved |

## Exploratory testing

| Metric | Kind | Definition |
| --- | --- | --- |
| Total charters | measured | Non-archived charters in scope. |
| Active sessions | measured | Sessions in the Active group. |
| Completed sessions | measured | Sessions in the Completed group. |
| Abandoned / draft sessions | measured | Count by status. Abandoned sessions are tracked separately and never counted as completed. |
| Session completion rate | measured | completed ÷ started. Empty (`null`) when no session has started. |
| Testing effort (h) | measured | Sum of timer-tracked time for sessions in scope. Paused time is excluded; running sessions contribute their live elapsed time. |
| Estimated vs actual | estimate vs measured | Completed sessions only: Σ timeboxes (estimate) vs Σ tracked time (measured). Ratio = actual ÷ estimate. A ratio above 1 means sessions overran their timebox. |
| Session distribution by tester | measured | Per tester: sessions, completed sessions, tracked hours. |
| Effort by milestone | measured | Tracked hours grouped by session milestone ("No milestone" bucket included). |
| Weekly activity | measured | Sessions created, findings created, and tracked hours per ISO week (Monday start, UTC). |
| Session time breakdown (per session) | estimate | Optional setup/test/bug investigation percentages entered by the tester at debrief (SBTM-style). Shown on the session; not aggregated. |

## Findings and defects

| Metric | Kind | Definition |
| --- | --- | --- |
| Findings by classification | measured | Count (and open count) per configured classification. Classifications with zero findings are hidden. |
| Findings by severity | measured | Count (and open count) per severity: Blocker, Critical, Major, Minor, Trivial. |
| Unresolved findings | measured | Status New or Triaged. |
| Confirmed defects | measured | Findings whose classification has **is defect** enabled (default: Confirmed defect), any status except Duplicate. Observations, questions, and risks are never counted as defects. |
| Defects by feature | measured | Confirmed defects grouped by the charter's *target* (feature under test). Top 15. |
| Defects by release | measured | Confirmed defects grouped by the milestone of the session they were found in. |
| Outstanding risks | measured | Open findings classified as Risk, plus High/Critical-risk charters with no completed session. |

## Test management and automation

| Metric | Kind | Definition |
| --- | --- | --- |
| Manual execution | measured | Latest status of every test-run item in scope (open and closed runs), grouped by status category. |
| Manual executed % | measured | Items with any status other than Untested/Retest ÷ all items. |
| Manual pass rate | measured | Passed ÷ executed. |
| Automation pass rate | measured | Σ passed ÷ (Σ total − Σ skipped) over completed automation runs in scope. Without a date filter, uses the last 30 days. |
| Automation trend | measured | Per completed run: passed, failed, skipped, pass rate. |
| Flaky indicator (per test) | heuristic | Over the test's last 10 completed results: flaky if it passed on retry at least once or flipped pass↔fail two or more times. Score = flips ÷ (results − 1). |

## Traceability

| Metric | Kind | Definition |
| --- | --- | --- |
| Requirement coverage | measured | Requirements (excluding Deprecated) with ≥1 linked charter that has a completed session **or** ≥1 linked test case with an executed result, ÷ all such requirements. |
| Requirement status | measured | Per requirement: **failing** if the latest result of any linked test case is Failed/Blocked or it has open defect findings; **untested** if not covered; **passing** if all linked test cases' latest results are Passed (or not yet run) and at least one was executed; otherwise **partial**. |
| Coverage gaps (`/reports/coverage-gaps`) | measured | Charters with no completed session; charters not explored in the last 30 days; uncovered requirements; active test cases never executed; tracked effort and findings per feature (charter target). Used to find areas that received insufficient testing. |

## Release readiness

`GET /reports/readiness?milestoneId=…` grades each indicator **pass**, **warn**, or **fail** against an explicit threshold. Indicators with no data are **n/a**: they are shown so the gap is visible, but they do not fail the release. The overall grade is the worst graded indicator, or `insufficient_data` if nothing can be graded.

| Indicator | Threshold |
| --- | --- |
| Open Blocker/Critical issues in the milestone | 0 = pass, otherwise fail |
| Untriaged potential/confirmed defects from milestone sessions | 0 = pass, ≤3 = warn, otherwise fail |
| Milestone charters explored (≥1 completed session) | ≥80% pass, ≥50% warn |
| Manual tests executed | ≥90% pass, ≥70% warn |
| Manual pass rate | ≥95% pass, ≥80% warn |
| Latest automation run pass rate | ≥95% pass, ≥80% warn |

The thresholds are fixed in this version; making them configurable per project is on the roadmap. Readiness is decision support, not an automatic release gate.

## Verification

`apps/server/test/reports.test.ts` checks the dashboard against independent Prisma queries over the same database: counts, completion rate, effort, confirmed defects, coverage, and the CSV/JSON exports.
The end-to-end suite (`e2e/tests/`) checks that UI-created records appear in the API.
