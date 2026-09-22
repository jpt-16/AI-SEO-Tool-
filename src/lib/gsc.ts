export const GSC_API = "https://searchconsole.googleapis.com/webmasters/v3";
export const GSC_ROW_LIMIT = 25_000;

export type GscDimension = "date" | "query" | "page" | "country" | "device";

export interface GscApiRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscQueryBody {
  startDate: string;
  endDate: string;
  dimensions: GscDimension[];
  type?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
}

// Matches OAuth2Client.request from google-auth-library.
export type GscRequester = <T>(opts: { url: string; method: "GET" | "POST"; data?: unknown }) => Promise<{ data: T }>;

export async function querySearchAnalytics(
  request: GscRequester,
  siteUrl: string,
  body: GscQueryBody,
): Promise<GscApiRow[]> {
  const url = `${GSC_API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const rows: GscApiRow[] = [];
  for (let startRow = 0; ; startRow += GSC_ROW_LIMIT) {
    const { data } = await request<{ rows?: GscApiRow[] }>({
      url,
      method: "POST",
      data: { type: "web", ...body, rowLimit: GSC_ROW_LIMIT, startRow },
    });
    const page = data.rows ?? [];
    rows.push(...page);
    if (page.length < GSC_ROW_LIMIT) return rows;
  }
}

export interface GscSiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

export async function listSites(request: GscRequester): Promise<GscSiteEntry[]> {
  const { data } = await request<{ siteEntry?: GscSiteEntry[] }>({ url: `${GSC_API}/sites`, method: "GET" });
  return (data.siteEntry ?? []).sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}
