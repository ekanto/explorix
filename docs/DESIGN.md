# Explorix design system

This document explains how the Explorix interface looks and why. It covers the 2.x redesign audit, the tokens, the shared components, layout rules and visual validation.

The stack is unchanged: React 19, Mantine 9.7, Tabler icons and Recharts through `@mantine/charts`. No additional CSS framework was added. Every custom style comes from two files:

| File | Contents |
|---|---|
| `apps/web/src/theme.ts` | Mantine theme: fonts, type scale, spacing, radii, shadows and component defaults. It also contains a `cssVariablesResolver` that adjusts Mantine's light, outline and gray variants for each colour scheme. |
| `apps/web/src/styles.css` | Semantic `--ex-*` tokens for each colour scheme, the shell, and the `.ex-*` layout and pattern classes. |
| `apps/web/src/components/ui.tsx` | Shared primitives: `PageHeader`, `SectionCard`, `SectionHeading`, `StatGrid`, `StatCard`, `EmptyState`, `TextBlock`, `UserLabel`, `StatusBadge` and others. |

## 1. Audit (before the redesign)

The audit used screenshots of every main screen. They were taken at 1440×900 and 1024×768 in both themes with `e2e/scripts/capture-screens.mjs`. Problems found, with their root causes:

| # | Problem | Root cause | Fix |
|---|---|---|---|
| 1 | Dark mode text was hard to read and surfaces barely separated. | Tokens used CSS `light-dark()` without `color-scheme`, so in dark mode every custom token kept its **light** value. Light-variant badges used shade 6 text. | Tokens are now defined per `:root[data-mantine-color-scheme=…]` with `color-scheme` set. A custom dark palette was added, and the resolver remaps light, outline and gray variant colours for each scheme. |
| 2 | Metric cards on the project dashboard were small and uneven in height. | A fixed `SimpleGrid` on viewport breakpoints, plus labels that truncated or wrapped arbitrarily. | `StatGrid` is a **container-aware** grid (1→2→3→6 columns depending on the space available). `StatCard` has a fixed structure: a label clamped to 2 lines, then the value, then a hint. |
| 3 | Large empty regions, for example a full-height "No open milestones" panel. | `EmptyState` always used a tall layout. | `EmptyState` is compact by default (icon, title, one sentence, action). |
| 4 | Dashboard cards had inconsistent widths and heights. | Ad-hoc `Grid` spans and per-card heights. | A single 12-column grid with deliberate spans: three-up analytics, then activity (8) beside high-risk charters (4), then three secondary metrics. Cards share header spacing and minimum chart heights. |
| 5 | Typography was small, light and inconsistent. Badges and micro-labels were uppercase at 9–11 px. | Mantine defaults and many local `fz`/`tt="uppercase"` overrides. | Inter Variable is bundled locally (`@fontsource-variable/inter`) with one type scale (§3). Badges are sentence case. Micro-labels use `.ex-label`. |
| 6 | Badges were truncated in tables ("Rea…") and dates wrapped onto two lines. | Auto table layout squeezes cells to their minimum content width. | Table badges get `min-width: max-content`. Date and duration cells use `.ex-nowrap`. Key text columns have a `miw`. |
| 7 | Release-readiness and status legends broke onto separate lines. | A circular empty Mantine `Badge` was used as an inline dot. | `.ex-legend-dot` inline spans. |
| 8 | Empty bands appeared at the top of finding cards. | Empty `Grid` rows still consumed `Stack` gaps. | `.ex-field-pair` collapses when it is `:empty`. |
| 9 | Dark "Read-only" alerts and `color="dark"` buttons rendered as black blocks. | Mantine's `dark` palette equals the dark surfaces. | The resolver overrides the `dark-filled`, `dark-light` and `gray-light` variables in dark mode. Charts use `dark.3` for "Abandoned". |
| 10 | The sidebar was dense, groups competed for attention, and there was no collapsed mode. | A flat link list. | Grouped, collapsible sections; a clear active row; an icon rail with tooltips (Ctrl+B); a stable footer. |
| 11 | Columns became too narrow at 1024 px: the test-case folder tree truncated and readiness cards wrapped badly. | Splits at the `md` breakpoint (62 em) left about 180 px columns beside the 256 px sidebar. | These splits now happen at `lg` and stack below it. Between 768 and 992 px the sidebar becomes a rail by default. |
| 12 | Long code blocks overflowed narrow panels (AI setup notice). | `Code block` uses `white-space: pre`. | The notice wraps (`pre-wrap`, `overflow-wrap:anywhere`). |

## 2. Colour tokens

Use semantic tokens rather than hex values. Mantine colour props (`c="dimmed"`, `color="red"`) are fine, because the resolver adapts them to the active scheme.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ex-bg` | `#f5f6f8` | `#17191d` | Application background |
| `--ex-sidebar` | `#fafbfc` | `#1b1e23` | Sidebar |
| `--ex-header` | `#ffffff` | `#1b1e23` | Top bar |
| `--ex-surface` | `#ffffff` | `#20242a` | Cards, tables, inputs |
| `--ex-surface-elevated` | `#ffffff` | `#262b32` | Menus, popovers, dialogs, tooltips |
| `--ex-subtle` | `#f3f5f7` | `#1c2025` | Inset areas (mission box, nested panels) |
| `--ex-fg` | `#171a1f` | `#f1f4f8` | Primary text |
| `--ex-fg-secondary` | `#3e4652` | `#b0bac8` | Labels, secondary text |
| `--ex-muted` | `#5b6472` | `#9ba6b5` | Metadata, helper text, placeholders |
| `--ex-border` / `--ex-border-strong` | `#e1e5ea` / `#cdd3db` | `#323943` / `#414955` | Dividers and card borders / input borders |
| `--ex-accent` | `#0f766e` | `#20b8a6` | Primary actions, active navigation, links |
| `--ex-focus` | `#0f766e` | `#3ccfbc` | 2 px focus ring |
| `--ex-success` / `--ex-warning` / `--ex-danger` / `--ex-info` | `#2b8a3e` / `#b35c00` / `#c92a2a` / `#1864ab` | `#51cf66` / `#fcc419` / `#ff6b6b` / `#4dabf7` | Status |

Measured contrast (WCAG 2.2 AA requires at least 4.5 for body text):

| Pair | Light | Dark |
|---|---:|---:|
| Primary text on surface | 17.4 | 14.1 |
| Secondary text on surface | 9.5 | 8.0 |
| Muted text on surface | 6.0 | 6.3 |
| Muted text on the page background | 5.5 | 7.1 |
| Accent text on surface | 5.5 | 6.3 |
| Text on a primary button | 5.5 | 7.5 |

The dark muted colour is `#9ba6b5`, slightly lighter than the suggested `#8f9baa` (5.5:1). This keeps metadata readable on elevated surfaces (5.8:1).

The dark theme is designed separately and is not an inversion of the light theme:
- Card shadows are removed.
- Surfaces separate through lightness steps (bg → surface → elevated) and quiet borders.
- Status colours use lighter shades.

## 3. Typography

Inter Variable is bundled with the app, so no remote font service is used. The fallback stack is Segoe UI and the system UI font. `cv11` and `ss01` are enabled for more legible digits and letterforms. `.ex-num` (tabular numbers) is used for metrics, timers, durations and counters.

| Element | Size | Weight |
|---|---:|---:|
| Page title (`PageHeader`, h1) | 28 px | 700 |
| Section heading (`SectionHeading`) | 18 px | 600 |
| Card heading (`SectionCard`) | 15–16 px | 600 |
| Body (`md`) | 14 px | 400 |
| Table content / navigation (`sm`) | 13–14 px | 400–550 |
| Form labels | 14 px | 500 |
| Metadata / helper (`xs`) | 12 px | 400 |
| Metric value (`StatCard`) | 28 px | 650, tabular |
| Session timer | 30 px | 650, tabular |
| Micro-label (`.ex-label`) | 13 px | 600, sentence case, secondary colour |

## 4. Spacing, shape and controls

- **Spacing** follows a 4/8 px scale: `xs` 8, `sm` 12, `md` 16, `lg` 24, `xl` 32. Page sections are 24–32 px apart and card content is 16–20 px. Dense lists use 8–12 px.
- **Radii:**
  - inputs and buttons 8 px;
  - badges 6 px;
  - cards 8 px;
  - dialogs 10 px;
  - avatars and progress bars are pill-shaped.
- **Elevation.** Borders do most of the separation work. A light card shadow appears in light mode only. Floating surfaces (menus, popovers, dialogs) use `--ex-shadow-pop`.
- **Control heights:**
  - small 32 px (`xs`/`sm` buttons and inputs);
  - default 36 px;
  - large 42 px.
  
  Toolbars use one height. The automation-run filter chips sit in a 36 px row so their label lines up with the inputs beside it.
- **Badges** are sentence case, use the light variant, and always include text. Colour is never the only signal. Status, classification, severity, priority, result and milestone badges come from the shared maps in `lib/constants.ts`.

## 5. Shell and layout

| Element | Behaviour |
|---|---|
| **Header (52 px)** | Holds the logo, the organisation / project breadcrumb (from `md`), global search (Ctrl+K), the keyboard-shortcut list, notifications, the theme toggle (Ctrl+J) and the user menu. All controls are 36 px high. |
| **Sidebar (256 px)** | Grouped, collapsible sections: Exploratory testing, Test management, Insights, Project. Each group's open state is saved. The project switcher is pinned at the top and Administration sits in a stable footer. |
| **Nav rows** | 36 px (nested 34 px). This is slightly below the suggested 38–42 px so all groups fit at 900 px height without scrolling. The row is still the full sidebar width, giving a large click target. |
| **Icon rail (68 px)** | Ctrl+B or the header toggle; tooltips label every icon. The rail preference is saved. Between 768 and 992 px the rail is the default; it can be expanded for the session. Below 768 px the sidebar becomes a drawer opened from the burger. |
| **Content** | Capped at `--ex-content-max` (1560 px) so very wide windows don't over-stretch tables and forms. Padding is 16 px below `md` and 24 px above. |
| **`PageHeader`** | Breadcrumb, title, description and actions aligned on one baseline. Actions wrap under the title in narrow windows. |

### Responsive rules

- Grids that hold cards use **container breakpoints** (`StatGrid`, the dashboard and overview grids), so they react to the space actually available after the sidebar.
- Two-column page splits (folders + table, readiness cards, form + side panel) stack below `lg` (1200 px viewport).
- Wide tables sit in `Table.ScrollContainer` and scroll inside their card. The page itself never scrolls horizontally. The capture script asserts this on every page at every size.

## 6. Patterns

- **`SectionCard`**: a card with a header (title, description, actions) and content. Use it only when the content is one meaningful group, and avoid nesting cards.
- **`EmptyState`**: compact by default, with an icon, a title, one sentence and an optional action. The action is shown only when the user has the permission for it. Charts with no data show this instead of an empty axis.
- **Tables:**
  - headers are 12 px, weight 600, muted, and never wrap;
  - cells use tabular numbers;
  - dates use `.ex-nowrap`;
  - the key title column has a minimum width;
  - badges keep their full width;
  - lists are sorted with keyboard-accessible `Select` controls.
- **Workbench:**
  - a header card holds the charter link, the timer (with its timebox progress) and the session actions;
  - notes and the chronological activity log come first, followed by mission, findings, evidence and details tabs;
  - findings and evidence are one keystroke away (press `?` to see all shortcuts).

## 7. Accessibility and motion

- Every focusable element shows a 2 px `--ex-focus` outline with a 2 px offset.
- Icon-only buttons have an `aria-label` and a tooltip. The navigation landmark is labelled, and the sidebar rail exposes labels through `aria-label`.
- Transitions are 120–200 ms (`--ex-dur` is 150 ms). All animation, including the timer pulse, is disabled under `prefers-reduced-motion: reduce`.
- Text colours meet AA in both themes (§2). Placeholders use `--ex-muted` at full opacity.
- Status always appears as text (badge labels, "Not ready", "0 open"), never only as colour.

## 8. Visual validation

```powershell
npm run dev                                   # web :5173, API :4000, demo seed
cd e2e
node scripts\capture-screens.mjs ..\screens --sizes=1920x1080,1440x900,1280x800,1024x768,800x700 --themes=light,dark
node scripts\capture-screens.mjs ..\screens --only=dashboard,workbench --sizes=1440x900
```

- The script logs in as the demo admin and captures 22 screens.
  - **Screens:** login, overview, my work, project dashboard (populated and empty), charters, the new-charter and charter-detail pages, sessions, the workbench, findings, finding detail, test cases, test runs, automation, automation run, issues, requirements, reports, the report builder, project settings and administration.
  - **Flags:** it prints `!! horizontal overflow` for any page that scrolls sideways.
- **Redesign validation.** The script ran at 1920, 1440, 1280, 1024, 900, 800 and 700 px wide in both themes, and no page overflowed.
- **Display scaling.** At Windows 125% and 150% scaling, a 1920 px screen gives Chromium a viewport of about 1536 or 1280 CSS px, which lies within the validated range.
- **Full-page screenshots.** The sidebar ends at the viewport height. It is fixed and scrolls independently, so this is a capture artifact, not a layout bug.
