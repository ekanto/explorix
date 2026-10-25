# Explorix — Market & Methodology Research

**Date of research:** 2026-10-25
**Prepared for:** Explorix, an original exploratory-testing and QA-management SaaS built from scratch (not affiliated with Testmo, Xray, PractiTest, Testpad, TestRail, Qase, or Zephyr).

---

## 1. Purpose & Method

This document summarizes publicly available information about exploratory-testing / QA-management competitor products and the session-based testing methodology that informs Explorix's design. It is intended to guide product scoping, not to copy any vendor's implementation.

**Method and constraints:**
- Only **publicly accessible web pages** were consulted: marketing pages, public documentation/support sites, and public blog/methodology articles. No login, trial account, paid plan, or private/internal content was accessed for any vendor.
- No vendor source code, proprietary APIs requiring authentication, or non-public material was examined.
- Where a page could not be fetched (404, blocked, JS-rendered content that didn't resolve to static text, etc.), this is explicitly noted rather than guessed at.
- Claims are labeled **Verified** (explicitly stated on a successfully fetched public page), **Inferred** (reasonably implied by public material but not explicitly stated), or **Proposed** (a new idea for Explorix, not attributed to any competitor).
- Research was conducted via automated fetching of the specific URLs requested plus directly linked pages one level deep, and targeted web searches for material not reachable by direct navigation (e.g., archived/historical methodology sources).
- All claims about a specific product are cited inline with the source URL immediately after the claim.

---

## 2. Research Summary by Objective

### 2.1 Testmo exploratory testing & session management

Testmo markets exploratory testing as a flagship, first-class capability rather than an add-on: *"Only available in Testmo: exploratory testing, session management & note taking as first-class features"* (https://www.testmo.com/exploratory-testing/). The homepage names it as one of four core pillars alongside AI test case management, test automation, and real-time reporting (https://www.testmo.com/). Sessions support rich note taking "including accurate time tracking, screenshots, test results and comments" and direct issue creation/linking to an external tracker (https://www.testmo.com/exploratory-testing/).

Testmo's public support documentation (support.testmo.com) gives much more concrete detail than the marketing pages: a session is described as *"a time-boxed, free-form testing activity,"* explicitly contrasted with a test run of predetermined cases (https://support.testmo.com/hc/en-us/articles/47549081153805-Exploratory-Sessions). Each session contains a **session log** made of **log entries**, which are either a **result** (has a status such as Passed/Failed/Blocked/Retest) or a plain **note** (no status) (same URL). The "Add session" dialog exposes fields: Name, Configuration, Milestone, **Mission** (a rich-text goal/focus field — functionally similar to a charter), Template, State, Assigned to, Estimate (accepts `1h`, `5m`, `30s`, `01:23:30` formats), Issues, Tags, Attachments (same URL). Session-level `Estimate` plus per-entry `Elapsed` time feed an activity chart and a "Total elapsed" rollup; a Sessions-page dashboard shows Active/Latest-results/Recently-closed metric cards (same URL).

### 2.2 Charter creation, session execution, notes, findings, evidence, issue linking

Testmo's "Mission" field functions as the charter/goal statement for a session and is set at session creation (https://support.testmo.com/hc/en-us/articles/47549081153805-Exploratory-Sessions). Testmo does not use the word "charter" on its public marketing or support pages — it uses **Mission**, **Session**, **Note**, and **Result** instead (https://www.testmo.com/exploratory-testing/; https://support.testmo.com/hc/en-us/articles/47549081153805-Exploratory-Sessions). Execution happens via chronological log entries that can be notes or status-tagged results, each optionally carrying its own elapsed time and its own issue links (distinct from the session-level Issues field) — i.e., Testmo supports both session-level and per-finding issue linking (same URL). Evidence capture includes screenshots/attachments and comments (https://www.testmo.com/exploratory-testing/).

Xray takes the most evidence-centric approach of the competitors researched: its dedicated companion "Xray Exploratory App" supports **screenshot, video, and audio recording with annotations** during a session, **timed charters** (a charter plus an explicit time limit), collaborative shared sessions across Dev/Support/QA, an activity timeline, and automated **PDF session reports** that can be attached back to a Jira Test Run (https://www.getxray.app/exploratory-testing/).

Testpad implements charters as **time-budgeted checklist prompts** inside an otherwise freeform, editable test plan — e.g., a heading annotated "[20 mins]" — and explicitly describes itself as *"a lightweight [session-based test management tool]... There are no timers or session metrics; teams that want the full SBTM ceremony usually pair Testpad with their own timebox"* (https://testpad.com/exploratory-testing/). Plans can be edited live during a session as new ideas surface, and **guest testers** can join via a link with no login/seat required, merging results into the same plan (same URL).

Neither TestRail nor Qase has a dedicated, purpose-built exploratory/session feature on their current public marketing pages; both only discuss exploratory testing as **educational blog content**, not as a described product capability (https://www.testrail.com/blog/track-exploratory-testing/; https://www.qase.io/blog/exploratory-testing/). TestRail's homepage states its "flexible structure fits... scripted, exploratory, manual, or automated" testing, implying exploratory work is handled via configurable case templates rather than a dedicated session object (https://www.testrail.com/). PractiTest's homepage, pricing, and integrations pages contain no mention of exploratory or session-based testing at all (https://www.practitest.com/; https://www.practitest.com/pricing/; https://www.practitest.com/integrations/).

### 2.3 Test case management, runs, plans, milestones

Testmo organizes test cases into per-project **repositories** with nested folders, tags, and custom fields, plus customizable templates, workflow states, and permissions (https://www.testmo.com/test-case-management/). Test runs are *"a time-bounded execution of a set of test cases"*; each selected case becomes a **test** instance in the run (https://support.testmo.com/hc/en-us/articles/47544002336653-Test-Runs). Run creation supports a 3-pane case-selection dialog (folder tree / case list / a dynamic filter builder with Set/Add/Remove modes and AND/OR combination) and an "Import from run" option to clone a prior run's case selection (same URL). The Test Case Repository supports drag-and-drop folder reordering and four alternate grouping views (Priority, State, Status-latest, Template) besides the default Folder view (https://support.testmo.com/hc/en-us/articles/40464014149133-Test-Case-Repository). **Milestones** group test runs, exploratory sessions, and automation runs under one tracking entity, support up to **3 levels of nested sub-milestones**, and carry a lifecycle of Upcoming → Started → Completed (https://support.testmo.com/hc/en-us/articles/47548614635789-Milestones; https://www.testmo.com/qa-project-milestones/).

Xray's test management is Jira-native: Tests, Test Sets, and Test Executions are modeled as Jira issue types, giving tight linkage to Agile boards and stories, plus a dedicated Requirement Traceability Report connecting requirements → Tests → Test Runs → defects (https://www.getxray.app/test-management/). PractiTest structures work around four pillars — Milestones, Requirements, Test Case Library, and Test Sets & Runs (https://www.practitest.com/pricing/). Qase organizes test suites with a traceability matrix linking cases to user stories/requirements, plus a "Smart Test Wizard" and global shared/reusable steps (https://www.qase.io/product/). Testpad deliberately avoids structured cases/steps — "a test is just a line of text" in an indentable outline, with test runs represented as columns next to each line (https://testpad.com/).

### 2.4 Automation result ingestion and CI/CD integrations

Testmo's primary ingestion path is a CLI tool, documented in full in its support docs. The core command is `testmo automation:run:submit`, which *"creates a new test automation run, submits test results and completes the run in a single step,"* taking `--instance`, `--project-id`, `--name`, `--source`, and `--results <files>` (JUnit XML, including recursive glob patterns) (https://support.testmo.com/hc/en-us/articles/37902053426445-Testmo-CLI-Reference). A parallel/threaded workflow is supported via `automation:run:create` → repeated `automation:run:submit-thread` (one call per CI job/thread) → `automation:run:complete` (same URL). Marketing copy describes this as *"a simple 5 minute integration"* that works with "any test automation tool, language and CI platform," automatically grouping tests into **sources**, and surfacing the most-failed, slowest, and flakiest tests (https://www.testmo.com/test-automation/). Named CI/CD integrations: GitHub, GitLab, CircleCI, Jenkins (https://www.testmo.com/test-automation/; https://www.testmo.com/integrations/).

Xray supports automation ingestion via REST/GraphQL API and a Jenkins plugin for importing JUnit/Cucumber results (https://www.getxray.app/test-management/). PractiTest offers **Firecracker**, described as "zero code CI/CD and automation test results integration," plus **xBot** for triggering/scheduling automation and a general REST API (https://www.practitest.com/integrations/). TestRail offers AI-assisted **Test Script Generation** (turns a documented case into Selenium/Playwright/Cucumber/Behave scaffolding in Java or Python) alongside named integrations for Selenium, testRigor, Ranorex, Jenkins, GitHub Actions, Azure DevOps, and Sauce Labs (https://www.testrail.com/; https://www.testrail.com/integrations/). Qase supports "35+ integrations" with native two-way sync for Jira, GitHub, and Azure DevOps, plus a **Qase Query Language (QQL)** for filtering runs (https://www.qase.io/product/). Testpad's CI/CD story is the lightest of all products researched: a generic "Connect your CI/CD using the API and webhooks," with no named framework integrations found on its public pages (https://testpad.com/).

### 2.5 Dashboards, reports, metrics, traceability

Testmo's QA Metrics & Reporting page advertises real-time status across runs/sessions/automation, customizable reports on *"traceability and coverage, test history, team workload,"* PDF/print export, burndown charts with completion forecasts, and a dedicated Traceability & Coverage Report (https://www.testmo.com/qa-metrics-reporting/). An advanced **Reporting Center** is gated to the Business and Enterprise pricing tiers (https://www.testmo.com/pricing/). Qase offers "customizable dashboards with KPIs... coverage, pass rates, failure trends, flakiness, cycle time" plus a root-cause-analysis drilldown from release → run → case → defect (https://www.qase.io/product/). PractiTest's "Advanced Data Management Pack" includes unlimited dashboards, downloadable reports, unlimited custom fields, and traceability/coverage reporting (https://www.practitest.com/pricing/). Xray provides cross-project reporting and the Requirement Traceability Report described above (https://www.getxray.app/test-management/). Zephyr (SmartBear) advertises "360-degree traceability" from requirements through execution results (https://smartbear.com/product/zephyr/). Testpad's reporting is limited to per-plan/per-session pass/fail/untested coverage reports, shareable as link, HTML, or PDF — no cross-project analytics dashboard was found (https://testpad.com/exploratory-testing/).

### 2.6 Projects, teams, assignments, permissions, admin

Testmo's permission model (documented in support docs) has four user types: Regular user, **Project admin** (Business/Enterprise; scoped access to project-level Admin settings), **Site admin** (full Admin access), and **API user** (machine account, doesn't consume a seat, Business/Enterprise) (https://support.testmo.com/hc/en-us/articles/38042459493517-Users-Permissions). Every user has one **global role**; optional **Groups** bundle project access for many users, with the **highest combined permission** across memberships winning (same URL). Per-project **Default access** can be set to a specific role, "No access," or inherit the global role, with per-user/per-group overrides (same URL). **Restricted fields** (Enterprise-only) let admins lock edit rights on specific custom fields (on Cases, Run results, or Sessions) to particular users/groups (same URL; https://support.testmo.com/hc/en-us/articles/38042642061709-Custom-Fields). The Roles REST API confirms roles carry an integer `permissions` bitmask and an `is_default` flag, with example role names "Read-only" and "Tester" (https://support.testmo.com/hc/en-us/articles/38159045680525-Roles). Enterprise/Business adds SSO (SAML, Google, Microsoft, Okta, OneLogin), 2FA with enforcement, and a complete user audit log (https://www.testmo.com/pricing/; https://www.testmo.com/enterprise-qa-testing/).

PractiTest's security/permission feature set includes SAML 2.0 SSO (Corporate plan), SCIM, MFA with enforcement, Users & Groups permissions, and an audit log (https://www.practitest.com/pricing/). TestRail's Enterprise tier adds SSO (SAML/OAuth/OIDC), MFA, audit logs, and project-level admin controls (https://www.testrail.com/pricing/). Qase's pricing comparison table shows SSO/advanced-permissions/audit-log-type rows gated mostly to its Enterprise tier, with some marked "Add-on" even there (row labels were not individually confirmed verbatim — see gaps) (https://www.qase.io/pricing/).

### 2.7 Custom fields, templates, filtering, exports, APIs

Testmo custom fields support ten types — Checkbox, Date, Dropdown, Float, Integer, Link, Multi-select, Steps (cases only), String, Text — assignable to test cases, test results, and sessions, with per-project overrides of defaults/options/required flags (https://support.testmo.com/hc/en-us/articles/38042642061709-Custom-Fields). **Templates** group which custom fields appear on a given case or session type; a field must be both assigned to the project and enabled on the chosen template to appear on a form, a documented common source of confusion (same URL). Testmo's REST API (OpenAPI-documented) exposes Users, Sessions, Runs, Roles, Results, Projects, Milestones, Issues, Groups, Folders, Fields, Cases, and Automation Source/Run/Link/Case resources, authenticated via per-user API keys or dedicated API users on Business/Enterprise (https://support.testmo.com/hc/en-us/articles/38338844725133-About-Testmo-REST-API; https://support.testmo.com/hc/en-us/articles/37838838517517-API-Authentication). Data export is a once-daily admin-level JSON dump of the full dataset (not re-importable, and attachments are excluded), plus per-session CSV export and bulk "session summary" or "ZIP of per-session CSVs" exports (https://support.testmo.com/hc/en-us/articles/38043070601357-Data-Exports; https://support.testmo.com/hc/en-us/articles/47549081153805-Exploratory-Sessions). Webhooks are explicitly listed in Testmo's own support-site navigation as **"Coming Soon"** — i.e., publicly documented as not yet released (noted in subagent navigation scan of support.testmo.com, article id `46877947282189-Testmo-Webhooks`), and the pricing page's feature comparison table independently confirms "Webhooks — Coming Soon" across all tiers (https://www.testmo.com/pricing/).

PractiTest offers unlimited custom fields (Advanced Data Management Pack), CSV/XML import, and an "Advanced migration tool" (https://www.practitest.com/pricing/). Qase supports CSV-style filtering via its QQL query language and exposes a developer API/reference site (https://www.qase.io/product/).

### 2.8 Capabilities in competitors that would benefit Explorix

Several specific competitor capabilities stand out as worth emulating or adapting (not copying) for Explorix: (a) Xray's rich **video/audio session recording with annotations** and auto-generated **PDF session reports** attachable to an issue tracker (https://www.getxray.app/exploratory-testing/); (b) Testpad's **guest tester** link-based participation with no account/seat required, useful for bringing in developers, support staff, or stakeholders for quick exploratory input (https://testpad.com/exploratory-testing/); (c) Testpad's fully public, flat, self-serve pricing with no sales gate (https://testpad.com/exploratory-testing/), in contrast to Xray and PractiTest, whose pricing is not transparently published on their own marketing sites; (d) Qase's low-cost "**collaborator seat**" ($10/seat, separate from full tester seats) for stakeholders who only need read/visibility access (https://www.qase.io/pricing/); (e) Qase's QQL-style query language and PractiTest's MCP (Model Context Protocol) integration for grounding AI agents in live QA data (https://www.qase.io/product/; https://www.practitest.com/integrations/); (f) Testmo's threaded/parallel automation-submission workflow (`automation:run:create` / `run:submit-thread` / `run:complete`) for CI matrix builds (https://support.testmo.com/hc/en-us/articles/37902053426445-Testmo-CLI-Reference); (g) PractiTest's "Firecracker" no-code CI/CD results wiring, lowering the integration bar versus a CLI-only approach (https://www.practitest.com/integrations/).

### 2.9 Opportunities to make Explorix easier/more effective (differentiators)

The research surfaces a clear **methodology gap**: Testmo, Xray, and Testpad all offer some form of session/charter feature, but none of the products researched explicitly implement the formal SBTM vocabulary and ceremony (charter → timeboxed session → **PROOF debrief** → **TBS percentage metrics** → opportunity-based charter reprioritization) described by Bach/Bach (https://en.wikipedia.org/wiki/Session-based_testing). Testpad explicitly says it deliberately omits "timers or session metrics" to stay lightweight (https://testpad.com/exploratory-testing/), and Testmo's "Mission" field and session metrics are close to SBTM but do not use charter/debrief/TBS terminology or automated opportunity-based prioritization (https://support.testmo.com/hc/en-us/articles/47549081153805-Exploratory-Sessions). This is a genuine opening for Explorix to be the first mainstream tool that operationalizes the full SBTM methodology (Proposed, see Section 3 and the feature matrix): a guided charter-builder using Hendrickson's "Explore `<target>` with `<resources>` to discover `<information>`" template, a built-in structured PROOF debrief flow, automatic computation of TBS (Test Design & Execution / Bug Investigation & Reporting / Session Setup) percentages from tagged log-entry time, and automatic flagging when a session's "off-charter opportunity time" exceeds the 25%/50% thresholds described in the original SBTM debrief checklist (https://web.archive.org/web/20080705020730/http://www.satisfice.com/sbtm/debrief_checklist.htm). A built-in library of SFDPOT and FEW HICCUPPS heuristic prompts to help testers write better charters is another concrete, low-risk differentiator with no direct competitor equivalent found in this research (https://www.satisfice.com/download/heuristic-test-strategy-model; https://developsense.com/blog/2012/07/few-hiccupps). Pairing a rigorous methodology core with Testpad-style simplicity (flat transparent pricing, guest testers, no forced database-centric case modeling for exploratory work) could differentiate Explorix from both the "heavy enterprise TCM" (TestRail, PractiTest) and "Jira-locked" (Xray, Zephyr) ends of the market.

### 2.10 Advanced capabilities to defer post-MVP

Based on competitor feature-gating patterns (most of the following are gated to the highest/Enterprise pricing tier across Testmo, TestRail, PractiTest, and Qase, implying they are valued but not core to initial adoption), Explorix should likely defer: SSO/SAML and directory integration (https://www.testmo.com/pricing/; https://www.testrail.com/pricing/; https://www.practitest.com/pricing/), enforced 2FA, full user audit logs (https://www.testmo.com/pricing/; https://www.practitest.com/pricing/), field-level "restricted fields" permissions (https://support.testmo.com/hc/en-us/articles/38042459493517-Users-Permissions), dedicated API-only/machine user accounts (https://www.testmo.com/enterprise-qa-testing/), an advanced "Reporting Center" beyond baseline dashboards (https://www.testmo.com/pricing/), AI-driven test case/script generation and prioritization (https://www.testrail.com/; https://www.getxray.app/test-management/; https://www.practitest.com/), an MCP/AI-agent server integration (https://www.qase.io/mcp-model-context-protocol/; https://www.practitest.com/integrations/), webhooks (notably still "Coming Soon" even for market leader Testmo itself — https://www.testmo.com/pricing/), and tenant-isolation/data-residency enterprise infrastructure claims (https://www.testmo.com/enterprise-qa-testing/). MVP focus should remain on: core session/charter execution, test case repository + runs, milestones, basic issue-tracker linking (one or two integrations, e.g. GitHub + Jira), CLI-based automation result ingestion, and a baseline dashboard — deferring the long tail of enterprise governance and AI features until product-market fit is established.

---

## 3. Session-Based Testing Methodology Notes

This section summarizes the formal session-based exploratory-testing methodology that should inform Explorix's data model and workflows, independent of any specific competitor product.

### 3.1 Session-Based Test Management (SBTM) — Jonathan Bach & James Bach

The canonical reference is Jonathan Bach's article "Session-Based Test Management" (STQE Magazine, November 2000), now hosted as a PDF download by Satisfice: *"This is the seminal article on Session-Based Test Management, written by my brother Jon and I based on the process we pioneered at Hewlett-Packard... SBTM is a kind of activity-based test management which is an alternative to artifact-based management"* (https://www.satisfice.com/download/session-based-test-management). Because the PDF itself is binary, the detailed structure below is drawn from archived HTML mirrors of the original satisfice.com/sbtm pages and from Wikipedia's page-cited summary of the same article.

**What a session is.** *"As in a recording studio, this work is done in 'sessions.' Sessions range from 45 minutes to several hours, but no matter the length, it is time spent testing against a charter for the session"* (https://web.archive.org/web/20080516120617/http://www.satisfice.com/sbtm). Wikipedia, citing Bach directly, describes a session as *"an uninterrupted period of time spent testing, ideally lasting one to two hours... focused on a charter"* while still allowing exploration of new opportunities (https://en.wikipedia.org/wiki/Session-based_testing). The original debrief checklist explicitly checks *"Was the session continuous and uninterrupted?"* (https://web.archive.org/web/20080705020730/http://www.satisfice.com/sbtm/debrief_checklist.htm) — i.e., timeboxing and non-interruption are first-class quality criteria for a session, not just a UI timer.

**What a charter is.** *"A charter is a goal or agenda for a test session... Charters are created by the test team prior to the start of testing, but they may be added or changed at any time. Often charters are created from a specification, test plan, or by examining results from previous sessions"* (https://en.wikipedia.org/wiki/Session-based_testing, citing Bach 2000, pp.1–2).

**Session report structure.** A real archived sample session report shows the exact field layout used in practice:
```
CHARTER         — the mission for the session
#AREAS          — product areas, OS, Build, Strategy keywords
START           — date/time session began
TESTER          — name(s)
TASK BREAKDOWN:
  #DURATION                         — length code (e.g., "short")
  #TEST DESIGN AND EXECUTION        — % of time
  #BUG INVESTIGATION AND REPORTING  — % of time
  #SESSION SETUP                    — % of time
  #CHARTER VS. OPPORTUNITY          — % split (e.g., 100/0)
DATA FILES      — files created/used
TEST NOTES      — chronological narrative of testing
BUGS            — defects found
ISSUES          — open questions/concerns
```
(https://web.archive.org/web/20080705021827/http://www.satisfice.com/sbtm/sample_session.htm). Wikipedia's independent summary of the Bach 2000 article matches this structure field-for-field (https://en.wikipedia.org/wiki/Session-based_testing).

**PROOF debrief framework.** A debrief is *"a short discussion between the manager and tester (or testers) about the session report."* Jonathan Bach's **PROOF** acronym structures it:
- **P**ast — "What happened during the session?"
- **R**esults — "What was achieved during the session?"
- **O**bstacles — "What got in the way of good testing?"
- **O**utlook — "What still needs to be done?"
- **F**eelings — "How does the tester feel about all this?"

(https://en.wikipedia.org/wiki/Session-based_testing, citing Bach 2000, pp. 9–10). The archived Satisfice page independently confirms debriefs typically take 15–20 minutes and use a companion checklist (https://web.archive.org/web/20080516120617/http://www.satisfice.com/sbtm).

**TBS metrics (Test / Bug / Setup).** The three task-breakdown categories recorded per session, confirmed directly from the sample report, are: **Test Design and Execution** (time spent designing/running tests), **Bug Investigation and Reporting** (time spent chasing and documenting bugs), and **Session Setup** (time spent on environment/data/tooling setup) — collectively abbreviated **TBS** in the debrief checklist, which asks *"Have the TBS definitions been followed? Have the TBS precedence rules been followed? Do the TBS numbers relate to On Charter work only?"* (https://web.archive.org/web/20080705020730/http://www.satisfice.com/sbtm/debrief_checklist.htm; https://web.archive.org/web/20080705021827/http://www.satisfice.com/sbtm/sample_session.htm). Aggregate program-level metrics built from many sessions include number of sessions completed, number of problems found, and function areas covered (https://web.archive.org/web/20080516120617/http://www.satisfice.com/sbtm).

**Charter vs. Opportunity.** Each session also records a percentage split between on-charter work and following unplanned leads ("opportunity"). The debrief checklist gives explicit guidance for using this number operationally: *"If the opportunity number is over 25%, consider modifying the charter. If the opportunity number is over 50%, modify the charter for this session and consider doing a new session based on the original charter"* (https://web.archive.org/web/20080705020730/http://www.satisfice.com/sbtm/debrief_checklist.htm). This is a directly actionable rule Explorix can implement as an automated nudge/alert.

**Current state of satisfice.com.** The original browsable `satisfice.com/sbtm` pages now redirect to a PDF-only download page (https://www.satisfice.com/download/session-based-test-management); a current, separately maintained "SBTM Session Report Checklist" (last updated July 7, 2021) is still available at https://www.satisfice.com/download/sbtm-session-report-checklist.

### 3.2 Elisabeth Hendrickson's "Explore It!" charter template

The charter template from Chapter 2 of Hendrickson's book *Explore It!* is consistently quoted across secondary sources as:

> **"Explore `<target>` with `<resources>` to discover `<information>`"**

with the breakdown: **Target** — "What are you exploring? It could be a feature, a requirement, or a module"; **Resources** — "What resources will you bring with you? Resources can be anything: a tool, a data set, a technique, a configuration, or perhaps an interdependent feature"; **Information** — "What kind of information are you hoping to find? Are you characterizing the security, performance, reliability, capability, usability or some other aspect of the system?" (https://guides.kenst.com/exploration/writing_exploratory_charters, which explicitly cites "Explore It!, Chapter 2, page 67 of 502 (ebook)"; identical attribution repeated at https://www.kenst.com/exploratory-testing-charters/). Example charters built on this pattern include "Explore editing profiles with injection attacks to discover security vulnerabilities" (https://guides.kenst.com/exploration/writing_exploratory_charters). **Caveat:** Hendrickson's own site (testobsessed.com) could not be reached directly in this research pass; the template is corroborated identically across two independent secondary pages that cite a specific page number in the book, giving reasonable confidence, but it should be treated as a **secondary-sourced** citation rather than a direct quote verified against the book or Hendrickson's own web page.

### 3.3 Testing heuristics

**SFDPOT.** Part of James Bach's Heuristic Test Strategy Model (HTSM), currently published at version 6.3 (Dec 2, 2024): *"The HTSM is a set of guideword heuristics designed to help you think better about test strategy... four focus areas: test techniques, project elements, product factors, and quality criteria categories"* (https://www.satisfice.com/download/heuristic-test-strategy-model — existence, authorship, and current version are primary-confirmed; the PDF itself could not be parsed to text). SFDPOT is a "Product Elements" guideword set, consistently reported by secondary sources discussing HTSM as: **S**tructure (what the product is made of), **F**unction (what it does), **D**ata (what it processes/stores), **P**latform (external dependencies: OS, browser, hardware), **O**perations (how it's actually used), **T**ime (concurrency/performance/sequencing) — the letter-by-letter definitions here should be treated as secondary paraphrase since the HTSM PDF itself was not machine-readable.

**FEW HICCUPPS.** Primary source: Michael Bolton's DevelopSense post "FEW HICCUPPS" (2012), attributing the original list to James Bach via Bolton's 2005 *Better Software* article "Testing Without a Map" (https://developsense.com/blog/2012/07/few-hiccupps). Direct quotes of each consistency oracle:
- **History** — "We expect the present version of the system to be consistent with past versions of it."
- **Image** — "We expect the system to be consistent with an image that the organization wants to project, with its brand, or with its reputation."
- **Comparable Products** — "We expect the system to be consistent with systems that are in some way comparable."
- **Claims** — "We expect the system to be consistent with things important people say about it... (specifications, design documents, manuals...) or in conversation."
- **Users' Desires** (originally "user expectations") — "We believe that the system should be consistent with ideas about what reasonable users might want."
- **Product** — "We expect each element of the system to be consistent with comparable elements in the same system" (internal consistency).
- **Purpose** — "We expect the system to be consistent with the explicit and implicit uses to which people might put it."
- **Statutes and Standards** — "We expect a system to be consistent with relevant statutes, acts, laws, regulations, or standards."

These eight form **HICCUPPS**; the same post extends it with two more to form **FEW HICCUPPS**: **Explainability** — "We expect a system to be understandable to the degree that we can articulately explain its behaviour to ourselves and others," and **World** — "We expect the product to be consistent with things that we know about or can observe in the world"; plus a distinct, inverse heuristic, **Familiarity** — "We expect the system to be inconsistent with patterns of familiar problems" (https://developsense.com/blog/2012/07/few-hiccupps). These oracle heuristics are directly useful as an in-app prompt library to help a tester decide whether an observed behavior is actually a bug.

**Test Heuristics Cheat Sheet.** Currently hosted by Ministry of Testing (article by Simon Tomes, 31 Mar 2022): *"Dive into the handy Test Heuristics Cheat Sheet, new and improved for today's modern testing professional. Support your testing efforts and generate test ideas"* (https://www.ministryoftesting.com/insights/test-heuristics-cheat-sheet). Its original authorship is ambiguous across sources (commonly associated with Elisabeth Hendrickson, distinct from Karen Johnson's separately-credited RCRCRC regression heuristic) — flagged here as **uncertain provenance**, though the Ministry of Testing host itself is confirmed live and reputable.

### 3.4 Other charter/session concepts relevant to design

- **Charters can exist independently of full SBTM ceremony** — e.g., used informally inside Jira tickets as sign-off criteria without timers or debriefs (https://www.kenst.com/exploratory-testing-charters/). This supports a flexible Explorix design where charter + session objects are usable standalone, with the full PROOF/TBS ceremony as an optional, not mandatory, layer.
- **Coverage-area tagging.** The sample session report's `#AREAS` field tags product area, OS, build, and "strategy" keywords (e.g., "DecideRight | OS: Win98 | Build: 1.2 | Strategy: Exploration & Analysis"), which roll up into aggregate "function areas covered" metrics (https://web.archive.org/web/20080705021827/http://www.satisfice.com/sbtm/sample_session.htm) — a direct precedent for a coverage-area taxonomy/tagging feature.
- **Charter backlog / reprioritization.** The Opportunity-percentage rule described in 3.1 is effectively a feedback loop for a charter backlog: sessions that drift off-charter generate signals to split or re-scope future charters (https://web.archive.org/web/20080705020730/http://www.satisfice.com/sbtm/debrief_checklist.htm).

---

## 4. Feature Matrix

Rows are grouped by area (session/exploratory testing, test case management, automation/CI, dashboards, admin/permissions, custom fields/API, integrations, Explorix-proposed differentiators) but presented as one continuous table per the required format. "Implementation status" reflects the Explorix 1.0 build as verified against the code (Done / Partial / Not implemented / Not applicable); see [CHECKLIST.md](CHECKLIST.md) for the full checklist.

| Feature | Description | Source product | Evidence / source URL | Verified / Inferred / Proposed | Priority (P0–P3) | Dependencies | Implementation status |
|---|---|---|---|---|---|---|---|
| Exploratory session object | A first-class, timeboxed "session" entity distinct from a scripted test run | Testmo | https://www.testmo.com/exploratory-testing/ | Verified | P0 | None | Done |
| Session mission/charter field | Rich-text goal/focus field set at session creation, functioning as a charter | Testmo | https://support.testmo.com/hc/en-us/articles/47549081153805-Exploratory-Sessions | Verified | P0 | Exploratory session object | Done — charters are first-class; sessions inherit the mission |
| Session template w/ custom fields | Templates control which custom fields appear on a session's add/edit form | Testmo | https://support.testmo.com/hc/en-us/articles/38042642061709-Custom-Fields | Verified | P1 | Custom fields engine | Partial — 15 editable charter templates; custom fields per entity (charter/session/finding), templates do not carry custom-field defaults |
| Session workflow state | Admin-defined states (e.g., In Progress, Ready for Review) drive session lifecycle | Testmo | https://support.testmo.com/hc/en-us/articles/47549081153805-Exploratory-Sessions | Verified | P1 | Exploratory session object | Done — draft/in progress/paused/in review/completed/approved/abandoned; review step configurable per project |
| Session log: notes vs. tagged results | Chronological log entries are either plain notes or status-tagged results | Testmo | https://support.testmo.com/hc/en-us/articles/47549081153805-Exploratory-Sessions | Verified | P0 | Exploratory session object | Done — rich-text notes + timestamped log entries + classified findings |
| Session time tracking | Session-level Estimate plus per-entry Elapsed time roll up into a Total Elapsed/activity chart | Testmo | https://support.testmo.com/hc/en-us/articles/47549081153805-Exploratory-Sessions | Verified | P0 | Exploratory session object | Done — server-side elapsed clock, pause/resume, estimate vs actual |
| Session screenshots/attachments | Attach screenshots and files directly to a session or log entry | Testmo | https://www.testmo.com/exploratory-testing/ | Verified | P0 | Exploratory session object | Done — upload, paste, drag-and-drop; type/size validated, authorized download |
| Session-level issue linking | Link one or more tracker issues at the session ("About") level | Testmo | https://support.testmo.com/hc/en-us/articles/47549081153805-Exploratory-Sessions | Verified | P0 | Issue tracker integration | Partial — via findings converted/linked to issues; no direct session↔issue link |
| Per-finding issue linking | Link a tracker issue to an individual log entry/finding, separate from session-level links | Testmo | https://support.testmo.com/hc/en-us/articles/47549081153805-Exploratory-Sessions | Verified | P1 | Issue tracker integration, Session log | Done — convert to internal issue or link existing |
| Bulk session creation & import | Create multiple sessions at once or import names/previous sessions as a batch | Testmo | https://support.testmo.com/hc/en-us/articles/47549081153805-Exploratory-Sessions | Verified | P2 | Exploratory session object | Not implemented — sessions are launched one at a time from charters |
| Session assignment & notifications | Assign a session to a user and notify them of changes | Testmo | https://www.testmo.com/exploratory-testing/ | Verified | P1 | User/role engine | Done — bulk assign + in-app notifications |
| Session tagging | Free-form tags on sessions for filtering/grouping | Testmo | https://www.testmo.com/exploratory-testing/ | Verified | P1 | Exploratory session object | Done — incl. bulk tag/untag |
| Session duplication/reuse | Duplicate or re-import a prior session as a starting point for a new one | Testmo | https://www.testmo.com/exploratory-testing/ | Verified | P2 | Exploratory session object | Done |
| Session metrics dashboard | Active/latest-results/recently-closed metric cards with per-status breakdown | Testmo | https://support.testmo.com/hc/en-us/articles/47549081153805-Exploratory-Sessions | Verified | P1 | Exploratory session object, Reporting engine | Done — see docs/METRICS.md |
| Session export (CSV/ZIP) | Export a single session or bulk-export sessions as summary CSV or per-session ZIP; result statuses used in the log are admin-configurable beyond the default Note/Passed/Failed | Testmo | https://support.testmo.com/hc/en-us/articles/47549081153805-Exploratory-Sessions | Verified | P2 | Exploratory session object | Partial — CSV/JSON via Reports export, per-session Markdown/JSON report; no ZIP with attachments |
| Video/audio session recording | Record screen/audio with annotations during a session; supports collaborative sessions where multiple testers (Dev/Support/QA) contribute to the same live run | Xray (Exploratory App) | https://www.getxray.app/exploratory-testing/ | Verified | P2 | Exploratory session object | Partial (2.0) — screen screenshot and video recording in the desktop app, with annotations, video markers and frames; no audio and no collaborative live sessions |
| Auto-generated session PDF report | Session activity auto-compiled into a shareable/attachable PDF report | Xray (Exploratory App) | https://www.getxray.app/exploratory-testing/ | Verified | P1 | Exploratory session object, Reporting engine | Done (2.0) — session, finding, charter, milestone and project reports in PDF, DOCX, Markdown and HTML, plus evidence packages ([REPORTING.md](REPORTING.md)) |
| Charter checklist with time budgets | Charter expressed as a checklist of prompts, each optionally annotated with a time budget | Testpad | https://testpad.com/exploratory-testing/ | Verified | P1 | Exploratory session object | Partial — per-charter timebox + test-idea checklist; no per-idea time budget |
| Guest tester (no-login) participation | External/ad hoc testers join a session via link, no account/seat required | Testpad | https://testpad.com/exploratory-testing/ | Verified | P2 | Exploratory session object, Access control | Not implemented |
| Mid-session editable plan | Testers add new charter lines/ideas live during testing without restarting | Testpad | https://testpad.com/exploratory-testing/ | Verified | P1 | Exploratory session object | Partial — testers check off test ideas in the workbench; charter edits require the charter form |
| Charter builder wizard | Guided form implementing "Explore `<target>` with `<resources>` to discover `<information>`" | Explorix (methodology) | https://guides.kenst.com/exploration/writing_exploratory_charters | Proposed | P1 | Exploratory session object | Done — template prefill, quality lint, heuristics recommender, optional AI draft |
| Structured PROOF debrief | Guided post-session debrief capturing Past/Results/Obstacles/Outlook/Feelings | Explorix (methodology) | https://en.wikipedia.org/wiki/Session-based_testing | Proposed | P1 | Exploratory session object | Done — finish dialog captures summary and TBS split |
| Automatic TBS metrics | Auto-compute Test Design & Execution / Bug Investigation & Reporting / Session Setup % from tagged log-entry time | Explorix (methodology) | https://web.archive.org/web/20080705021827/http://www.satisfice.com/sbtm/sample_session.htm | Proposed | P2 | Session time tracking, Session log | Partial — setup/test/bug split is entered by the tester at debrief, not measured automatically |
| Charter-vs-opportunity auto-flagging | Flag sessions exceeding 25%/50% off-charter time per SBTM debrief rules, suggesting charter split | Explorix (methodology) | https://web.archive.org/web/20080705020730/http://www.satisfice.com/sbtm/debrief_checklist.htm | Proposed | P2 | Automatic TBS metrics | Partial — captured manually at debrief; no automatic flagging |
| Testing heuristics prompt library | In-app SFDPOT and FEW HICCUPPS prompts to help write charters and judge findings | Explorix (methodology) | https://www.satisfice.com/download/heuristic-test-strategy-model ; https://developsense.com/blog/2012/07/few-hiccupps | Proposed | P2 | Charter builder wizard | Done — built-in deterministic library, works without AI |
| Charter backlog with risk prioritization | Queue of candidate charters prioritized by risk/coverage gaps, fed by prior session outcomes | Explorix (methodology) | https://web.archive.org/web/20080705020730/http://www.satisfice.com/sbtm/debrief_checklist.htm | Proposed | P2 | Charter builder wizard | Done — risk level, priority filters/sort; unexplored/stale high-risk charters in coverage gaps |
| Coverage-area tagging taxonomy | Structured area/OS/build/strategy tags on a session, rolling up into "areas covered" metrics | Explorix (methodology) | https://web.archive.org/web/20080705021827/http://www.satisfice.com/sbtm/sample_session.htm | Proposed | P2 | Session tagging | Partial — free-form project tags; no hierarchical taxonomy |
| Test case repository | Per-project repository with nested folders, tags, and custom fields | Testmo | https://www.testmo.com/test-case-management/ | Verified | P0 | Custom fields engine | Done — nested folders, versions, CSV import/export |
| Test case templates | Customizable templates controlling which fields appear per case type | Testmo | https://www.testmo.com/test-case-management/ | Verified | P1 | Test case repository | Partial — steps and Gherkin formats; no user-defined case templates |
| Shared/reusable test steps | A global library of steps reusable across multiple test cases | Qase | https://www.qase.io/product/ | Verified | P2 | Test case repository | Not implemented |
| Dynamic case-selection filter | AND/OR filter builder with Set/Add/Remove modes for selecting cases into a run, plus an "Import from run" option to clone a prior run's case selection | Testmo | https://support.testmo.com/hc/en-us/articles/47544002336653-Test-Runs | Verified | P1 | Test case repository | Partial — runs are created from selected cases or folders; no saved dynamic query |
| Multiple repository grouping views | View the case repository grouped by Folder, Priority, State, Status, or Template | Testmo | https://support.testmo.com/hc/en-us/articles/40464014149133-Test-Case-Repository | Verified | P2 | Test case repository | Not implemented — folder tree only |
| Milestones grouping runs/sessions/automation | A milestone is a container tracking runs, sessions, and automation runs together | Testmo | https://support.testmo.com/hc/en-us/articles/47548614635789-Milestones | Verified | P0 | Test runs, Exploratory session object | Done |
| Nested milestone hierarchy | Sub-milestones nest up to 3 levels deep, with aggregated parent stats | Testmo | https://support.testmo.com/hc/en-us/articles/47548614635789-Milestones | Verified | P2 | Milestones | Not implemented — flat milestones |
| Requirements traceability matrix | Report linking requirements → test cases → runs/executions → defects; includes native Gherkin/Cucumber (BDD) scenario authoring as a case format | Xray; PractiTest; Qase | https://www.getxray.app/test-management/ ; https://www.practitest.com/pricing/ ; https://www.qase.io/product/ | Verified | P1 | Test case repository, Issue tracker integration | Partial — requirement coverage from linked cases, charters and findings; no matrix export |
| CLI automation result submission | Command-line tool submits automation results in one step (`automation:run:submit`) | Testmo | https://support.testmo.com/hc/en-us/articles/37902053426445-Testmo-CLI-Reference | Verified | P0 | Automation runs | Not implemented — use the REST API (curl examples in docs/INTEGRATIONS.md) |
| JUnit XML ingestion with glob patterns | Parse JUnit XML result files, including recursive glob file matching | Testmo | https://support.testmo.com/hc/en-us/articles/37902053426445-Testmo-CLI-Reference | Verified | P0 | CLI automation result submission | Partial — JUnit XML ingestion via API; no client-side glob tool |
| Threaded/parallel automation submission | `run:create` → multiple `run:submit-thread` calls → `run:complete` for CI matrix builds | Testmo | https://support.testmo.com/hc/en-us/articles/37902053426445-Testmo-CLI-Reference | Verified | P1 | CLI automation result submission | Done — staged runs: create, append result batches, complete |
| Automation "sources" auto-grouping | Automated tests are automatically grouped into named sources per project | Testmo | https://www.testmo.com/test-automation/ | Verified | P1 | Automation runs | Done — sources are created automatically by name (no source editor) |
| Flaky/slow/failing test identification | Surface most-failed, slowest, and flaky tests across automation runs | Testmo | https://www.testmo.com/test-automation/ | Verified | P1 | Automation runs, Reporting engine | Done — flaky score from last 10 results; failing tests and run comparison |
| Named CI/CD integrations | First-party integration guidance for GitHub, GitLab, CircleCI, Jenkins | Testmo | https://www.testmo.com/test-automation/ ; https://www.testmo.com/integrations/ | Verified | P1 | CLI automation result submission | Partial — documented GitHub Actions/GitLab/Jenkins recipes calling the API; no native plugins |
| REST/GraphQL automation API | API-based (not just CLI) submission and query of automation results | Xray | https://www.getxray.app/test-management/ | Verified | P2 | Automation runs | Done (REST only) |
| No-code CI/CD results wiring | Zero-code connector ("Firecracker") pulling automation results into the tool | PractiTest | https://www.practitest.com/integrations/ | Verified | P2 | Automation runs | Not implemented |
| AI-assisted test script generation | Convert a documented manual case into automation scaffolding (e.g., Selenium/Playwright) | TestRail | https://www.testrail.com/ | Verified | P3 | Test case repository | Not implemented |
| AI test case generation from requirements | Generate draft test cases from requirements/user stories/plain-language prompts | Testmo; TestRail; Xray; PractiTest | https://www.testmo.com/ ; https://www.testrail.com/ ; https://www.getxray.app/test-management/ ; https://www.practitest.com/ | Verified | P3 | Test case repository | Partial — AI drafts regression cases from findings and charters from user stories (requires configured provider) |
| Real-time coverage/progress dashboard | Live status of all runs, sessions, automation runs, and milestones | Testmo | https://www.testmo.com/qa-metrics-reporting/ | Verified | P0 | Test runs, Exploratory session object, Automation runs | Done — computed on request from persisted records |
| Burndown chart & forecast | Progress burndown with completion forecast based on estimates and velocity | Testmo | https://www.testmo.com/qa-metrics-reporting/ | Verified | P2 | Milestones, Reporting engine | Not implemented |
| Traceability & coverage report | Report mapping specs/user stories/issues to test coverage | Testmo | https://www.testmo.com/qa-metrics-reporting/ | Verified | P1 | Requirements traceability matrix | Partial — requirement coverage and coverage-gap report |
| PDF/print report export | Filter and export any report/dashboard view as a print-optimized PDF | Testmo | https://www.testmo.com/qa-metrics-reporting/ | Verified | P2 | Reporting engine | Partial — print-friendly dashboard pages; generated PDF/DOCX reports cover findings, sessions and test execution (2.0), not arbitrary dashboard views |
| Customizable KPI dashboards | User-configurable dashboards for coverage, pass rate, flakiness, cycle time, with root-cause drilldown from a release view into specific runs/cases/linked defects | Qase | https://www.qase.io/product/ | Verified | P1 | Reporting engine | Not implemented — fixed dashboard with filters |
| Advanced "Reporting Center" (tier-gated) | A deeper analytics module beyond baseline dashboards, gated to higher pricing tiers | Testmo | https://www.testmo.com/pricing/ | Verified | P3 | Reporting engine | Not applicable |
| Multi-tier roles | Regular user / Project admin / Site admin / API user role types | Testmo | https://support.testmo.com/hc/en-us/articles/38042459493517-Users-Permissions | Verified | P0 | User/role engine | Done — org Owner/Admin/Member + project Admin/Lead/Tester/Viewer |
| Groups for permission bundling | Groups grant project access to many users at once; highest combined permission wins | Testmo | https://support.testmo.com/hc/en-us/articles/38042459493517-Users-Permissions | Verified | P1 | Multi-tier roles | Done — teams can be added to projects |
| Per-project default access override | Per-project default role (or "No access") with per-user/group overrides | Testmo | https://support.testmo.com/hc/en-us/articles/38042459493517-Users-Permissions | Verified | P1 | Multi-tier roles | Partial — explicit project membership only; no org-wide default role |
| Restricted (field-level) permissions | Lock edit rights on specific custom fields to certain users/groups | Testmo (Enterprise) | https://support.testmo.com/hc/en-us/articles/38042459493517-Users-Permissions | Verified | P3 | Custom fields engine, Multi-tier roles | Not implemented |
| SSO (SAML/OIDC) | Single sign-on via SAML, Google, Microsoft, Okta, OneLogin | Testmo; TestRail; PractiTest | https://www.testmo.com/pricing/ ; https://www.testrail.com/pricing/ ; https://www.practitest.com/pricing/ | Verified | P3 | User/role engine | Not implemented (roadmap) |
| Two-factor authentication + enforcement | TOTP-based 2FA with an admin-enforced policy option | Testmo | https://www.testmo.com/pricing/ | Verified | P3 | User/role engine | Not implemented (roadmap) |
| Full user audit log | Detailed log of user actions across the system | Testmo; PractiTest | https://www.testmo.com/enterprise-qa-testing/ ; https://www.practitest.com/pricing/ | Verified | P3 | User/role engine | Done — audit events with actor, entity and diff |
| Dedicated API-only machine users | Service accounts that don't consume a regular seat and can't log into the UI | Testmo | https://www.testmo.com/enterprise-qa-testing/ | Verified | P3 | Multi-tier roles | Partial — personal API tokens (hashed, revocable); no separate machine-user type |
| Custom field type library | Checkbox, Date, Dropdown, Float, Integer, Link, Multi-select, Steps, String, Text field types, assignable to all or specific projects with per-project defaults | Testmo | https://support.testmo.com/hc/en-us/articles/38042642061709-Custom-Fields | Verified | P0 | None | Done — text, textarea, number, select, multi-select, checkbox, date, URL |
| Scheduled full data export (JSON) | Once-daily admin-level export of the full dataset schema+data for backup/migration | Testmo | https://support.testmo.com/hc/en-us/articles/38043070601357-Data-Exports | Verified | P2 | None | Partial — on-demand org JSON export; no scheduling |
| Query language for advanced filtering | A dedicated query syntax (QQL) for filtering runs/cases beyond basic field filters | Qase | https://www.qase.io/product/ | Verified | P2 | Test case repository | Not implemented — structured filters only |
| OpenAPI-documented REST API | Fully documented REST API with resource reference and OpenAPI schema | Testmo | https://support.testmo.com/hc/en-us/articles/38338844725133-About-Testmo-REST-API | Verified | P1 | None | Done — /api/docs |
| Jira two-way issue integration | Create/link Jira issues from test artifacts; Jira project ↔ project mapping | Testmo; TestRail; Qase; Xray | https://support.testmo.com/hc/en-us/articles/37803519150349-Jira-Integration-Overview ; https://www.testrail.com/integrations/ ; https://www.qase.io/product/ | Verified | P1 | Issue tracker integration | Not implemented — returns 501; planned |
| GitHub issue integration | Push/link GitHub Issues from test artifacts via an installed app | Testmo | https://support.testmo.com/hc/en-us/articles/37817058477709-GitHub-Issues | Verified | P1 | Issue tracker integration | Partial — one-way push of internal issues to GitHub |
| GitLab issue integration | Push/link GitLab issues via personal/project token plus an OAuth app for per-user actions | Testmo | https://support.testmo.com/hc/en-us/articles/37817178801933-GitLab-Issues | Verified | P2 | Issue tracker integration | Not implemented — returns 501; planned |
| MCP server for AI-agent integration | Expose QA data to AI agents via the Model Context Protocol | Testmo (beta); Qase; PractiTest | https://www.testmo.com/pricing/ ; https://www.qase.io/mcp-model-context-protocol/ ; https://www.practitest.com/integrations/ | Verified | P3 | OpenAPI-documented REST API | Not implemented |
| Webhooks for outbound events | Push session/run/issue change events to external systems | Testmo (publicly "Coming Soon", not yet released) | https://www.testmo.com/pricing/ | Verified | P3 | OpenAPI-documented REST API | Done — HMAC-signed, 9 event types; no retries |
| Low-cost viewer/collaborator seat | Cheap, restricted seat type for stakeholders who only need read/visibility access | Explorix (pricing idea, inspired by Qase) | https://www.qase.io/pricing/ | Proposed | P2 | Multi-tier roles | Partial — Viewer role exists; no billing |
| Transparent flat-rate pricing tiers | Publicly listed, self-serve flat-rate plans with no sales gate | Explorix (positioning idea, inspired by Testpad) | https://testpad.com/exploratory-testing/ | Proposed | P1 | None | Not applicable (no billing in this build) |
| Offline desktop application | Installable Windows app with local database and evidence, no server or internet required | Explorix (2.0 requirement) | — | Proposed | P0 (2.0) | Server, web app | Done (2.0) — Electron + embedded PostgreSQL, NSIS installer ([DESKTOP.md](DESKTOP.md)) |
| Evidence package export | Self-contained folder/ZIP with report, original evidence, manifest and checksums | Explorix (2.0 requirement) | — | Proposed | P0 (2.0) | Reporting engine, evidence store | Done (2.0) |
| Full backup and restore | Database + evidence backup with checksum verification and safety backup before restore | Explorix (2.0 requirement; cf. Testmo data exports) | https://support.testmo.com/hc/en-us/articles/38043070601357-Data-Exports | Proposed | P0 (2.0) | Evidence store | Done (2.0) |

---

## 5. Pricing / Positioning Notes

### Testmo
Three monthly, self-serve, publicly listed tiers (https://www.testmo.com/pricing/):

| Tier | Price | Users included | Key inclusions (cumulative) |
|---|---|---|---|
| Team | $59/month | 5 users | Unlimited projects, test cases/plans/runs/milestones/results, unlimited automation results; Jira/GitHub/GitLab/Linear/CI integrations; "Testmo AI" |
| Business | $249/month | 15 users | Everything in Team, plus Reporting Center, Customizable Role-Based Access, Project Admins |
| Enterprise | $599/month | 25 users | Everything in Business, plus SSO (Google/Microsoft/Okta/OneLogin/SAML), two-factor auth + enforcement, complete user audit log, Automation Launching |

Annual billing saves 15%; a volume discount is available above 500 users; no on-premise edition is offered ("Testmo is a cloud web application") (https://www.testmo.com/pricing/). Positioning: *"The AI test management platform purpose-built for small & growing teams"* and explicitly *"Unlike enterprise tools, Testmo avoids heavy configuration and governance layers"* (https://www.testmo.com/).

### Testpad
Fully public, flat-rate, self-serve pricing, no sales gate, 30-day free trial on all tiers (https://testpad.com/exploratory-testing/):

| Plan | Annual (per month) | Monthly | Testers | Notable inclusions |
|---|---|---|---|---|
| Essential | $49 | $59 | up to 3 | Report sharing, email support; no image attachments or guest testers |
| Team (most popular) | $99 | $119 | up to 10 | Full feature set: image attachments, guest testers, API access |
| Team 15 | $149 | $179 | up to 15 | Same full feature set as Team |
| Department | $249 | $299 | up to 25 | Same full feature set as Team |

Custom/invoiced plans available for larger teams. Positioning: "Test plans, not test cases" — a lightweight alternative explicitly contrasted against "the overhead and busywork of outdated test case management" (https://testpad.com/).

### TestRail
Three tiers: **Essentials** (cloud-only, capped at 5 users), **Professional**, and **Enterprise** (both Professional/Enterprise support on-premise with a 10-seat minimum and 12-month contract; 500+ users directed to sales) (https://www.testrail.com/pricing/). All plans get a 30-day free trial, no credit card required, and no permanently free tier; SOC 2 and ISO 27001 apply to all plans; AI features (test case/script generation, prioritization) are included on every plan rather than gated to a top tier (https://www.testrail.com/pricing/). Positioning has shifted toward "AI-driven test management" (https://www.testrail.com/).

### Qase
Per-seat pricing: **Free** ($0/user, for students/hobbyists/educators/non-profits), **Teams** ($35/user/month billed annually, $42/month billed monthly, 14-day free trial), **Enterprise** (custom/"Talk to sales") (https://www.qase.io/pricing/). A separate, cheaper **$10/seat "collaborator"** tier exists for stakeholders who only need to view releases, not author/run tests (https://www.qase.io/pricing/). AI credits are granted monthly per plan and do not roll over; extra credits cost $0.40 each (https://www.qase.io/pricing/).

### Xray
No numeric pricing is published directly on getxray.app; pricing is quoted via the Atlassian Marketplace and billed per total Jira-instance user count (not just testers), since Atlassian requires companion-app tiers to track the host Jira tier (https://www.getxray.app/test-management/, which states: *"Prices listed above are estimates... Please visit the Atlassian Marketplace for a license quote"*). Two editions are named on the marketing site — **Standard** and **Advanced** (differing mainly in storage, API rate limits, and AI script-generation features) — plus a separately listed **Xray Enterprise** app (https://www.getxray.app/test-management/; https://docs.getxray.app/space/XRAYCLOUD/393183414/App+Editions).

### PractiTest
No numeric pricing is published on practitest.com itself; pricing figures render dynamically and did not resolve via static fetch (confirmed on both `/pricing/` and raw HTML). Plan names are confirmed via help docs rather than the marketing pricing page: **Team** (minimum 5 tester licenses, 5 free "Read-Only with Comments" users per license) and **Corporate** (minimum 10 tester licenses, 10 free comment-only users per license); legacy pre-2023 plans were named Professional, Enterprise, Ultimate (https://www.practitest.com/help/getting-started/pricing/). Feature packs (Advanced Data Management, Integration, Productivity/AI, Control & Compliance) are itemized on the pricing page but gated to specific plans without visible dollar amounts (https://www.practitest.com/pricing/).

### Zephyr (SmartBear) — bonus
Sold exclusively through the Atlassian Marketplace as three tiered apps — **Essential**, **Standard**, **Advanced** — rather than a direct SmartBear price table; no numeric pricing was found on `smartbear.com/product/zephyr/` itself (https://smartbear.com/product/zephyr/).

### Cross-vendor positioning takeaway
Pricing transparency varies sharply: Testmo, Testpad, and Qase publish clear self-serve numbers on their own marketing sites; Xray, PractiTest, and Zephyr require a marketplace calculator, sales contact, or in-app checkout to learn an actual price. This is a concrete opportunity for Explorix to differentiate on **pricing transparency** (publicly listed flat/tiered pricing, à la Testpad/Testmo/Qase) while keeping the product standalone (not requiring ownership of a separate platform like Jira, unlike Xray/Zephyr).

---

## 6. Sources Consulted

Status legend: ✅ fetched successfully and used as a citation source · ⚠️ partially resolved (e.g., JS-rendered content, binary PDF) · ❌ failed to load / 404 / blocked (not used as a citation source; noted in the relevant section above).

### Testmo
- ✅ https://www.testmo.com/
- ✅ https://www.testmo.com/features/
- ✅ https://www.testmo.com/exploratory-testing/
- ✅ https://www.testmo.com/test-case-management/
- ✅ https://www.testmo.com/qa-metrics-reporting/
- ✅ https://www.testmo.com/test-automation/
- ✅ https://www.testmo.com/integrations/
- ✅ https://www.testmo.com/pricing/
- ✅ https://www.testmo.com/qa-project-milestones/
- ✅ https://www.testmo.com/enterprise-qa-testing/
- ✅ https://www.testmo.com/qa-productivity/ (consulted for context, not separately cited)
- ⚠️ https://docs.testmo.com/docs/billing/pricing (linked from pricing page; not independently fetched)

### Testmo support documentation (support.testmo.com)
- ✅ https://support.testmo.com/hc/en-us/articles/47549081153805-Exploratory-Sessions
- ✅ https://support.testmo.com/hc/en-us/articles/38042642061709-Custom-Fields
- ✅ https://support.testmo.com/hc/en-us/articles/37902053426445-Testmo-CLI-Reference
- ✅ https://support.testmo.com/hc/en-us/articles/38338844725133-About-Testmo-REST-API
- ✅ https://support.testmo.com/hc/en-us/articles/37838838517517-API-Authentication
- ✅ https://support.testmo.com/hc/en-us/articles/38159977518989-Sessions (Sessions API)
- ✅ https://support.testmo.com/hc/en-us/articles/38159045680525-Roles (Roles API)
- ✅ https://support.testmo.com/hc/en-us/articles/37803519150349-Jira-Integration-Overview
- ✅ https://support.testmo.com/hc/en-us/articles/37817224198029-Jira-Cloud
- ✅ https://support.testmo.com/hc/en-us/articles/37817058477709-GitHub-Issues
- ✅ https://support.testmo.com/hc/en-us/articles/37817178801933-GitLab-Issues
- ✅ https://support.testmo.com/hc/en-us/articles/38042459493517-Users-Permissions
- ✅ https://support.testmo.com/hc/en-us/articles/38043070601357-Data-Exports
- ✅ https://support.testmo.com/hc/en-us/articles/47548614635789-Milestones
- ✅ https://support.testmo.com/hc/en-us/articles/47544002336653-Test-Runs
- ✅ https://support.testmo.com/hc/en-us/articles/40464014149133-Test-Case-Repository
- ⚠️ https://support.testmo.com/ (direct `web_fetch` returned HTTP 403; content rendered and read via browser tooling instead — same public pages, no login used)
- ❌ Not opened in depth (confirmed to exist in nav, but not read): Jira Server/DC overview, GitHub/GitLab Integration Overview pages, Projects/Users/Results/Runs/Cases/Folders/Fields/Automation-* API reference pages, "Using the REST API," Audit Logs article, Reporting Center article, Tests & Test Results article
- ❌ Webhooks article (`46877947282189-Testmo-Webhooks`) — confirmed via nav to be filed under "Coming Soon," i.e., documented as not yet released

### Xray (getxray.app)
- ✅ https://www.getxray.app/
- ✅ https://www.getxray.app/exploratory-testing/
- ✅ https://www.getxray.app/test-management/
- ✅ https://docs.getxray.app/space/XRAYCLOUD/393183414/App+Editions
- ⚠️ https://marketplace.atlassian.com/apps/1211769/xray-test-management-for-jira?tab=pricing&hosting=cloud (pricing widget is JS-rendered; numeric values did not resolve in static fetch)
- ❌ https://www.getxray.app/pricing/ — 404
- ❌ https://www.getxray.app/features/ — 404
- ❌ https://www.getxray.app/ci-cd-integration/ — 404

### PractiTest
- ✅ https://www.practitest.com/
- ✅ https://www.practitest.com/pricing/ (plan-pack list resolved; numeric prices did not resolve — JS/canvas-rendered)
- ✅ https://www.practitest.com/help/getting-started/pricing/
- ✅ https://www.practitest.com/integrations/
- ✅ https://www.practitest.com/resource-center/blog/test-management-comparison-table/ (redirected from `/test-management/`)
- ❌ https://www.practitest.com/features/ — 404

### Testpad
- ✅ https://testpad.com/
- ✅ https://testpad.com/exploratory-testing/
- ✅ https://testpad.com/why-manual-testing-matters/ (positioning context, not separately cited)
- ✅ https://testpad.com/traditional-test-case-management/
- ❌ https://testpad.com/pricing/ and https://testpad.com/pricing — 404 (pricing embedded on `/exploratory-testing/` instead)
- ❌ https://testpad.com/integrations/ — 404
- ❌ https://www.g2.com/products/testpad-testpad/pricing — 403 (blocked)

### TestRail
- ✅ https://www.testrail.com/
- ✅ https://www.testrail.com/pricing/
- ✅ https://www.testrail.com/integrations/
- ✅ https://www.testrail.com/blog/track-exploratory-testing/
- ❌ https://www.testrail.com/features/ — 404

### Qase
- ✅ https://www.qase.io/ (redirected to https://www.qase.io/)
- ✅ https://www.qase.io/pricing/
- ✅ https://www.qase.io/product/
- ✅ https://www.qase.io/blog/exploratory-testing/
- ⚠️ https://developers.qase.io/ and https://www.qase.io/mcp-model-context-protocol/ (referenced/linked, not independently fetched in full)

### Zephyr (SmartBear) — bonus comparison
- ✅ https://smartbear.com/product/zephyr/ (redirected from the requested `smartbear.com/test-management/zephyr/`)

### Session-Based Testing Methodology
- ⚠️ https://www.satisfice.com/download/session-based-test-management (confirmed to exist/describe itself; underlying PDF is binary and could not be parsed to text)
- ✅ https://web.archive.org/web/20080516120617/http://www.satisfice.com/sbtm (archived original SBTM overview page)
- ✅ https://web.archive.org/web/20080705020730/http://www.satisfice.com/sbtm/debrief_checklist.htm (archived SBTM debrief checklist)
- ✅ https://web.archive.org/web/20080705021827/http://www.satisfice.com/sbtm/sample_session.htm (archived sample session report)
- ✅ https://web.archive.org/web/20080724182607/http://www.satisfice.com/sbtm/demo/reports/status.htm (archived aggregate metrics example)
- ✅ https://en.wikipedia.org/wiki/Session-based_testing (page-cited summary of Bach 2000)
- ✅ https://www.satisfice.com/download/sbtm-session-report-checklist (current SBTM session report checklist, James Bach, updated 2021)
- ⚠️ https://www.satisfice.com/download/heuristic-test-strategy-model (HTSM existence/version/authorship confirmed; PDF itself binary/not parsed to text)
- ✅ https://developsense.com/blog/2012/07/few-hiccupps (Michael Bolton, primary source for HICCUPPS/FEW HICCUPPS)
- ✅ https://www.ministryoftesting.com/insights/test-heuristics-cheat-sheet (Simon Tomes, 2022)
- ✅ https://guides.kenst.com/exploration/writing_exploratory_charters (Hendrickson charter template, secondary)
- ✅ https://www.kenst.com/exploratory-testing-charters/ (Hendrickson charter template, secondary, corroborating)
- ❌ testobsessed.com / exploratorytesting.com (Elisabeth Hendrickson's own site) — not directly reachable in this research pass (DNS/TLS error); template corroborated via two independent secondary sources instead

### Not fetched / out of scope for this pass
- docs.testmo.com (separate documentation subdomain referenced from the pricing page for a full price list)
- Dedicated Xray CI/CD landing page, PractiTest/Testpad consolidated "features" hub pages (all 404'd — see above)
- Deeper TestRail Jira-integration subpage and AI/roadmap pages beyond the homepage and `/integrations/`
- Qase's `developers.qase.io` API reference and MCP product page (linked/mentioned only)

---

*End of document.*
