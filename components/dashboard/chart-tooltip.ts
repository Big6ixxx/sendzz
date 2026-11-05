/**
 * The chart tooltip: a card in the page's own type, on the theme's surface so it reads in light
 * and dark. Inline styles (what the chart library takes), so the colours are the theme tokens.
 */
export const CHART_TOOLTIP = {
  contentStyle: {
    backgroundColor: 'var(--lp-surface)',
    border: 'none',
    borderRadius: 16,
    boxShadow: '0 0 0 1px rgb(var(--lp-hair) / 0.06), 0 12px 32px -12px rgb(17 26 19 / 0.25)',
    padding: '10px 14px',
  },
  itemStyle: { color: 'var(--lp-ink)', fontSize: 13, fontWeight: 600 },
  labelStyle: { color: 'var(--lp-muted)', fontSize: 12, marginBottom: 2 },
};
