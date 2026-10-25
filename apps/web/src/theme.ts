import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Explorix brand: deep teal ("explore") with an amber accent ("discovery").
const explorix: MantineColorsTuple = [
  '#e6fbf8',
  '#c9f2ec',
  '#97e4d9',
  '#61d5c5',
  '#36c8b4',
  '#1bb5a1',
  '#0f9484',
  '#0f766e',
  '#115e59',
  '#0b3f3c',
];

const amber: MantineColorsTuple = ['#fff8e1', '#ffefc2', '#ffde85', '#fdcb47', '#fbbf24', '#f5ad0a', '#d99000', '#b07300', '#8a5a00', '#5e3d00'];

export const theme = createTheme({
  primaryColor: 'explorix',
  primaryShade: { light: 7, dark: 5 },
  colors: { explorix, amber },
  defaultRadius: 'md',
  fontFamily: 'Inter, "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", "Cascadia Code", Consolas, ui-monospace, monospace',
  headings: { fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif', fontWeight: '650' },
  cursorType: 'pointer',
  components: {
    Button: { defaultProps: { radius: 'md' } },
    Badge: { defaultProps: { radius: 'sm', variant: 'light' } },
    Paper: { defaultProps: { radius: 'md' } },
    Card: { defaultProps: { radius: 'md', withBorder: true } },
    Tooltip: { defaultProps: { withArrow: true, openDelay: 300 } },
    Modal: { defaultProps: { centered: true, overlayProps: { blur: 2 } } },
    Table: { defaultProps: { highlightOnHover: true, verticalSpacing: 'xs' } },
  },
});
