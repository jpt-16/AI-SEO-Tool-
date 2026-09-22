import { load, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

export const CRAWLER_USER_AGENT = "JTBuildsSEOBot/1.0 (+https://jtbuildsco.com)";

// Mirrors public.page_key() in the crawler migration; the join depends on both agreeing.
export function pageKey(url: string): string {
  const rest = url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  const host = (rest.match(/^[^/?#]*/)?.[0] ?? "")
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/:(80|443)$/, "");
  const path = (rest.match(/^[^/?#]*(\/[^?#]*)/)?.[1] ?? "").replace(/\/+$/, "");
  return host + (path || "/");
}

export function hostKey(url: string): string {
  return pageKey(url).split("/")[0];
}

const NON_HTML = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|txt|zip|mp4|mov|webm|mp3|wav|woff2?|ttf|otf|docx?|xlsx?|pptx?)$/i;

export function isCrawlableUrl(url: URL): boolean {
  return (url.protocol === "https:" || url.protocol === "http:") && !NON_HTML.test(url.pathname);
}

const collapse = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();

// Joins text nodes with spaces so <h1>Beverly<span>Your car</span></h1> reads "Beverly Your car".
function visibleText(nodes: AnyNode[]): string {
  const parts: string[] = [];
  const walk = (node: AnyNode) => {
    if (node.type === "text") parts.push(node.data);
    else if ("children" in node) node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return collapse(parts.join(" "));
}

// Top-level entity types only (each block, or each item of an @graph); nested types
// like PostalAddress are still in the stored JSON-LD.
function collectSchemaTypes(value: unknown, into: Set<string>) {
  if (Array.isArray(value)) value.forEach((v) => collectSchemaTypes(v, into));
  else if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    if (Array.isArray(node["@graph"])) collectSchemaTypes(node["@graph"], into);
    [node["@type"]].flat().forEach((t) => typeof t === "string" && into.add(t));
  }
}

export interface ExtractedPage {
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  h2: string[];
  wordCount: number;
  internalLinkCount: number;
  internalLinks: string[];
  jsonLd: unknown[];
  schemaTypes: string[];
}

export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const $: CheerioAPI = load(html);
  const base = new URL($("base[href]").attr("href") ?? pageUrl, pageUrl);
  const siteHost = hostKey(pageUrl);
  const selfKey = pageKey(pageUrl);

  const title = $("title").filter((_, el) => $(el).closest("svg").length === 0).first();
  const description = $('meta[name="description" i]').first().attr("content");

  const jsonLd: unknown[] = [];
  $('script[type="application/ld+json" i]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      jsonLd.push(JSON.parse(raw));
    } catch {
      jsonLd.push({ "@error": "Invalid JSON-LD", raw: raw.slice(0, 500) });
    }
  });
  const types = new Set<string>();
  collectSchemaTypes(jsonLd, types);

  let internalLinkCount = 0;
  const internalLinks = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")!.trim();
    if (!href || href.startsWith("#")) return;
    let target: URL;
    try {
      target = new URL(href, base);
    } catch {
      return;
    }
    if (!/^https?:$/.test(target.protocol) || hostKey(target.href) !== siteHost) return;
    target.hash = "";
    if (pageKey(target.href) === selfKey) return;
    internalLinkCount++;
    if (isCrawlableUrl(target)) internalLinks.add(target.href);
  });

  const body = $("body").clone();
  body.find("script, style, noscript, template, svg, iframe, [hidden], [aria-hidden='true']").remove();
  const bodyText = visibleText(body.toArray());

  return {
    title: title.length ? collapse(title.text()) || null : null,
    metaDescription: description === undefined ? null : collapse(description),
    h1: $("h1").toArray().map((el) => visibleText([el])).filter(Boolean),
    h2: $("h2").toArray().map((el) => visibleText([el])).filter(Boolean),
    wordCount: bodyText ? bodyText.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0,
    internalLinkCount,
    internalLinks: [...internalLinks],
    jsonLd,
    schemaTypes: [...types].sort(),
  };
}

export function parseSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const $ = load(xml, { xml: true });
  const locs = (selector: string) =>
    $(selector)
      .toArray()
      .map((el) => $(el).text().trim())
      .filter(Boolean);
  return { pages: locs("urlset > url > loc"), sitemaps: locs("sitemapindex > sitemap > loc") };
}

export interface RobotsRules {
  sitemaps: string[];
  disallow: string[];
  allow: string[];
}

// Only the rules for all crawlers (User-agent: *) apply; we don't claim a named agent.
export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { sitemaps: [], disallow: [], allow: [] };
  let groupAgents: string[] = [];
  let inRules = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const [, field, value] = match;
    const key = field.toLowerCase();
    if (key === "sitemap") rules.sitemaps.push(value);
    else if (key === "user-agent") {
      if (inRules) groupAgents = [];
      inRules = false;
      groupAgents.push(value.toLowerCase());
    } else if (key === "disallow" || key === "allow") {
      inRules = true;
      if (groupAgents.includes("*") && value) rules[key].push(value);
    }
  }
  return rules;
}

export function isAllowed(rules: RobotsRules, url: URL): boolean {
  const path = url.pathname + url.search;
  const longest = (prefixes: string[]) =>
    Math.max(-1, ...prefixes.filter((p) => path.startsWith(p.replace(/\*.*$/, ""))).map((p) => p.length));
  return longest(rules.allow) >= longest(rules.disallow);
}

export interface CrawledPage extends Partial<ExtractedPage> {
  url: string;
  statusCode: number | null;
  inSitemap: boolean;
  error: string | null;
}

export interface CrawlOptions {
  maxPages?: number;
  concurrency?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

async function fetchText(fetchImpl: typeof fetch, url: string, timeoutMs: number) {
  const res = await fetchImpl(url, {
    redirect: "follow",
    headers: { "User-Agent": CRAWLER_USER_AGENT, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { res, text: await res.text() };
}

async function readSitemaps(fetchImpl: typeof fetch, start: string[], timeoutMs: number): Promise<string[]> {
  const pages: string[] = [];
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length && seen.size < 50) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const { res, text } = await fetchText(fetchImpl, url, timeoutMs);
      if (!res.ok) continue;
      const parsed = parseSitemap(text);
      pages.push(...parsed.pages);
      queue.push(...parsed.sitemaps);
    } catch {
      // A missing or broken sitemap just means we rely on links.
    }
  }
  return pages;
}

// Crawls one site: seeds from the sitemap (if any) plus the homepage, then follows
// internal links so pages missing from the sitemap are found too.
export async function crawlSite(origin: string, options: CrawlOptions = {}): Promise<CrawledPage[]> {
  const { maxPages = 300, concurrency = 4, timeoutMs = 15_000, fetchImpl = fetch } = options;
  const home = new URL("/", origin).href;
  const siteHost = hostKey(home);

  let robots: RobotsRules = { sitemaps: [], disallow: [], allow: [] };
  try {
    const { res, text } = await fetchText(fetchImpl, new URL("/robots.txt", home).href, timeoutMs);
    if (res.ok) robots = parseRobots(text);
  } catch {
    // No robots.txt: everything is allowed.
  }

  const sitemapPages = await readSitemaps(
    fetchImpl,
    robots.sitemaps.length ? robots.sitemaps : [new URL("/sitemap.xml", home).href],
    timeoutMs,
  );
  const sitemapKeys = new Set(sitemapPages.map(pageKey));

  const queued = new Set<string>();
  const queue: string[] = [];
  const enqueue = (url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url, home);
    } catch {
      return;
    }
    parsed.hash = "";
    const key = pageKey(parsed.href);
    if (queued.has(key) || hostKey(parsed.href) !== siteHost || !isCrawlableUrl(parsed) || !isAllowed(robots, parsed)) return;
    queued.add(key);
    queue.push(parsed.href);
  };
  enqueue(home);
  sitemapPages.forEach(enqueue);

  const results = new Map<string, CrawledPage>();
  const crawlOne = async (url: string) => {
    const requestedKey = pageKey(url);
    try {
      const { res, text } = await fetchText(fetchImpl, url, timeoutMs);
      const finalUrl = res.url || url;
      if (hostKey(finalUrl) !== siteHost) return;
      const key = pageKey(finalUrl);
      if (results.has(key)) return;
      const inSitemap = sitemapKeys.has(key) || sitemapKeys.has(requestedKey);
      const isHtml = /html/i.test(res.headers.get("content-type") ?? "");
      if (!res.ok) {
        results.set(key, { url: finalUrl, statusCode: res.status, inSitemap, error: `HTTP ${res.status}` });
        return;
      }
      if (!isHtml) return;
      const page = extractPage(text, finalUrl);
      results.set(key, { url: finalUrl, statusCode: res.status, inSitemap, error: null, ...page });
      queued.add(key);
      page.internalLinks.forEach(enqueue);
    } catch (err) {
      if (results.has(requestedKey)) return;
      const message = err instanceof Error ? (err.name === "TimeoutError" ? "Timed out" : err.message) : "Fetch failed";
      results.set(requestedKey, { url, statusCode: null, inSitemap: sitemapKeys.has(requestedKey), error: message });
    }
  };

  let started = 0;
  const worker = async () => {
    while (queue.length && started < maxPages) {
      started++;
      await crawlOne(queue.shift()!);
    }
  };
  // Workers that find an empty queue exit, so restart them while links keep appearing.
  while (queue.length && started < maxPages) {
    await Promise.all(Array.from({ length: concurrency }, worker));
  }

  return [...results.values()];
}
