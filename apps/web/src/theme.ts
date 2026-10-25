import { ActionIcon, Badge, Button, Input, createTheme, rem, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';

/*
 * Explorix design tokens (Mantine layer).
 *
 * Semantic CSS tokens (--ex-*) live in styles.css and are defined per color scheme; this file
 * configures Mantine so its own components (inputs, menus, modals…) resolve to the same palette.
 * See docs/DESIGN.md for the full token reference.
 */

// Brand teal: 7 is the light-theme accent (#0f766e, AA with white text); 5 is the dark-theme accent (#20b8a6, AA with dark text).
const explorix: MantineColorsTuple = ['#e6fbf8', '#c9f2ec', '#97e4d9', '#61d5c5', '#38c6b3', '#20b8a6', '#159a8b', '#0f766e', '#115e59', '#0b3f3c'];

const amber: MantineColorsTuple = ['#fff8e1', '#ffefc2', '#ffde85', '#fdcb47', '#fbbf24', '#f5ad0a', '#d99000', '#b07300', '#8a5a00', '#5e3d00'];

// Neutral, slightly cool dark ramp. Mantine maps: 0 text, 2 dimmed, 4 borders, 5/6 control surfaces, 7 body.
const dark: MantineColorsTuple = ['#f1f4f8', '#c9d1dc', '#b0bac8', '#7d8898', '#353c46', '#2d333b', '#262b32', '#20242a', '#1b1e23', '#17191d'];

const FONT = '"Inter Variable", Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';

const FZ = { xs: rem(12), sm: rem(13), md: rem(14), lg: rem(16), xl: rem(18) } as const;

export const theme = createTheme({
  primaryColor: 'explorix',
  primaryShade: { light: 7, dark: 5 },
  colors: { explorix, amber, dark },
  autoContrast: true,
  luminanceThreshold: 0.32,
  respectReducedMotion: true,
  cursorType: 'pointer',
  defaultRadius: 'md',
  fontFamily: FONT,
  fontFamilyMonospace: '"JetBrains Mono", "Cascadia Mono", "Cascadia Code", Consolas, ui-monospace, monospace',
  fontSizes: FZ,
  lineHeights: { xs: '1.4', sm: '1.45', md: '1.5', lg: '1.5', xl: '1.45' },
  spacing: { xs: rem(8), sm: rem(12), md: rem(16), lg: rem(24), xl: rem(32) },
  radius: { xs: rem(4), sm: rem(6), md: rem(8), lg: rem(10), xl: rem(16) },
  shadows: {
    xs: '0 1px 2px rgba(16, 24, 40, 0.05)',
    sm: '0 1px 3px rgba(16, 24, 40, 0.08), 0 1px 2px rgba(16, 24, 40, 0.04)',
    md: '0 8px 20px -6px rgba(16, 24, 40, 0.18), 0 2px 6px rgba(16, 24, 40, 0.06)',
    lg: '0 16px 32px -8px rgba(16, 24, 40, 0.22), 0 4px 8px rgba(16, 24, 40, 0.06)',
    xl: '0 24px 48px -12px rgba(16, 24, 40, 0.28)',
  },
  headings: {
    fontFamily: FONT,
    fontWeight: '650',
    sizes: {
      h1: { fontSize: rem(28), lineHeight: '1.25', fontWeight: '700' },
      h2: { fontSize: rem(22), lineHeight: '1.3', fontWeight: '650' },
      h3: { fontSize: rem(18), lineHeight: '1.35', fontWeight: '600' },
      h4: { fontSize: rem(16), lineHeight: '1.4', fontWeight: '600' },
      h5: { fontSize: rem(14), lineHeight: '1.4', fontWeight: '600' },
      h6: { fontSize: rem(13), lineHeight: '1.4', fontWeight: '600' },
    },
  },
  components: {
    // 32 / 36 / 42 px control heights (heights are tuned in styles.css); 14px labels for standard controls.
    Button: Button.extend({
      defaultProps: { radius: 'md' },
      vars: (_t, p) => ({ root: { '--button-fz': p.size === 'xs' || p.size === 'compact-xs' || p.size === 'compact-sm' ? FZ.sm : !p.size || p.size === 'sm' || p.size === 'md' ? FZ.md : undefined } }),
    }),
    ActionIcon: ActionIcon.extend({ defaultProps: { radius: 'md' } }),
    Input: Input.extend({
      vars: (_t, p) => ({ wrapper: { '--input-fz': !p.size || p.size === 'sm' || p.size === 'md' ? FZ.md : undefined } }),
    }),
    InputWrapper: Input.Wrapper.extend({
      styles: { label: { fontWeight: 550, marginBottom: rem(4) }, description: { fontSize: FZ.xs, marginBottom: rem(6) }, error: { fontSize: FZ.xs } },
    }),
    Badge: Badge.extend({ defaultProps: { radius: 'sm', variant: 'light' } }),
    Paper: { defaultProps: { radius: 'md' } },
    Card: { defaultProps: { radius: 'md', withBorder: true, padding: 'md' } },
    Alert: { defaultProps: { radius: 'md' } },
    Tooltip: { defaultProps: { withArrow: true, openDelay: 300, fz: 'xs' } },
    Modal: { defaultProps: { centered: true, radius: 'lg', overlayProps: { backgroundOpacity: 0.5 } } },
    Drawer: { defaultProps: { overlayProps: { backgroundOpacity: 0.5 } } },
    Menu: { defaultProps: { shadow: 'md', radius: 'md' } },
    Popover: { defaultProps: { shadow: 'md', radius: 'md' } },
    Combobox: { defaultProps: { shadow: 'md', radius: 'md' } },
    Table: { defaultProps: { highlightOnHover: true, verticalSpacing: 'xs', horizontalSpacing: 'sm' } },
    Progress: { defaultProps: { radius: 'xl' } },
    Notification: { defaultProps: { radius: 'md' } },
  },
});

/** Light-scheme text colour for "light"/"subtle" variants: Mantine's shade 6 fails AA on tinted backgrounds (e.g. yellow badges). */
const TINTS = ['gray', 'red', 'pink', 'grape', 'violet', 'indigo', 'blue', 'cyan', 'teal', 'green', 'lime', 'yellow', 'orange', 'explorix', 'amber'];
const lightTextVars = Object.fromEntries(
  TINTS.flatMap((c) => {
    const v = `color-mix(in srgb, var(--mantine-color-${c}-9) ${['yellow', 'lime', 'amber'].includes(c) ? 62 : 82}%, #000)`;
    return [
      [`--mantine-color-${c}-light-color`, v],
      [`--mantine-color-${c}-text`, v],
    ];
  }),
);

/** Overrides Mantine's scheme-level variables so built-in components use the Explorix palettes. */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    ...lightTextVars,
    '--mantine-color-body': '#ffffff',
    '--mantine-color-text': '#171a1f',
    '--mantine-color-dimmed': '#5b6472',
    '--mantine-color-default-border': '#d3d8df',
    '--mantine-color-placeholder': '#8a929e',
    '--mantine-color-default-hover': '#f2f4f6',
  },
  dark: {
    '--mantine-color-body': '#20242a',
    '--mantine-color-text': '#f1f4f8',
    '--mantine-color-dimmed': '#9ba6b5',
    '--mantine-color-default': '#262b32',
    '--mantine-color-default-hover': '#2d333b',
    '--mantine-color-default-border': '#3b434e',
    '--mantine-color-placeholder': '#7d8898',
    '--mantine-color-anchor': '#3ccfbc',
    // Neutral variants: Mantine's defaults resolve to near-black on the Explorix dark surfaces.
    '--mantine-color-gray-light': 'rgba(176, 186, 200, 0.10)',
    '--mantine-color-gray-light-hover': 'rgba(176, 186, 200, 0.16)',
    '--mantine-color-gray-light-color': '#c9d1dc',
    '--mantine-color-gray-outline': '#7d8898',
    '--mantine-color-dark-filled': '#3b434e',
    '--mantine-color-dark-filled-hover': '#475160',
    '--mantine-color-dark-light': 'rgba(176, 186, 200, 0.12)',
    '--mantine-color-dark-light-hover': 'rgba(176, 186, 200, 0.18)',
    '--mantine-color-dark-light-color': '#d6dce5',
    '--mantine-color-dark-outline': '#7d8898',
    '--mantine-color-dark-text': '#c9d1dc',
  },
});
