export interface MetricRow {
  clicks: number;
  impressions: number;
  position: number;
}

export interface Totals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

// Position is impression-weighted, the same way Search Console averages it.
export function summarize(rows: MetricRow[]): Totals | null {
  if (rows.length === 0) return null;
  let clicks = 0;
  let impressions = 0;
  let weightedPosition = 0;
  for (const row of rows) {
    clicks += row.clicks;
    impressions += row.impressions;
    weightedPosition += row.position * row.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? weightedPosition / impressions : 0,
  };
}

export function percentChange(current: number, prior: number): number | null {
  return prior ? (current - prior) / prior : null;
}
