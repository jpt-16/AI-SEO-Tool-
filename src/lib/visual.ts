// Visual capture: loads each page in headless Chromium the same way every time, then
// measures it and takes a screenshot. Repeatability comes from:
//  - one fixed viewport, device scale, user agent, locale, timezone and colour scheme;
//  - waiting for network idle (not just DOMContentLoaded), then again after a scroll
//    pass that triggers lazy images and scroll-reveal content;
//  - FREEZE_CSS injected so nothing is mid-animation or mid-transition;
//  - a fixed SETTLE_MS pause before measuring and capturing.
import { createHash } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { FREEZE_CSS, scoreVisual, SETTLE_MS, VISUAL_VIEWPORT, type VisualMetrics, type VisualScore } from "./visual-core";

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 JTBuildsSEOBot/1.0";
const NAV_TIMEOUT_MS = 30_000;
const QUIET_MS = 500;
const QUIET_MAX_MS = 10_000;

const isServerless = () => Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  if (isServerless()) {
    // Serverless: a Chromium build packaged for Lambda-style environments.
    const serverless = (await import("@sparticuz/chromium")).default;
    return chromium.launch({ executablePath: await serverless.executablePath(), args: serverless.args, headless: true });
  }
  // Locally: CHROMIUM_PATH, or the browser from `npx playwright-core install chromium`.
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
}

async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: VISUAL_VIEWPORT,
    screen: VISUAL_VIEWPORT,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    userAgent: USER_AGENT,
    locale: "en-US",
    timezoneId: "America/New_York",
    colorScheme: "light",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  // Freeze animations from the first paint, before any page script runs.
  await context.addInitScript(`(() => {
    const add = () => {
      const style = document.createElement("style");
      style.setAttribute("data-freeze", "");
      style.textContent = ${JSON.stringify(FREEZE_CSS)};
      (document.head || document.documentElement).appendChild(style);
    };
    if (document.documentElement) add(); else document.addEventListener("readystatechange", add, { once: true });
  })()`);
  return context;
}

// waitQuiet() resolves once no request has been in flight for QUIET_MS (or after
// QUIET_MAX_MS); failed() counts requests that failed, which can leave a page half-rendered.
function trackNetwork(page: Page) {
  let inflight = 0;
  let failed = 0;
  let lastActivity = Date.now();
  const bump = (delta: number) => () => {
    inflight = Math.max(0, inflight + delta);
    lastActivity = Date.now();
  };
  page.on("request", bump(1));
  page.on("requestfinished", bump(-1));
  page.on("requestfailed", bump(-1));
  page.on("requestfailed", () => failed++);
  const waitQuiet = async (): Promise<boolean> => {
    const started = Date.now();
    while (Date.now() - started < QUIET_MAX_MS) {
      if (inflight === 0 && Date.now() - lastActivity >= QUIET_MS) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  return { waitQuiet, failed: () => failed };
}

// Scrolls one screen at a time to the bottom (lazy images, scroll-reveal), then back to the top.
const SCROLL_PASS_SCRIPT = `(async () => {
  const step = window.innerHeight;
  const max = Math.min(document.documentElement.scrollHeight, 30000);
  for (let y = 0; y < max; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
  window.scrollTo(0, 0);
  document.querySelectorAll("video").forEach((v) => { try { v.pause(); v.currentTime = 0; } catch (e) {} });
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
})()`;

// Measures the settled page. Plain JS in a string so no bundler helpers leak into it.
export const VISUAL_METRICS_SCRIPT = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const clean = (t) => (t || "").replace(/\\s+/g, " ").trim();
  const short = (t) => { t = clean(t); return t.length > 70 ? t.slice(0, 67) + "…" : t; };
  const parse = (c) => {
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const blend = (top, under) => {
    const a = top[3];
    return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
  };
  const lum = (c) => {
    const f = (v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const opacityOf = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
  // Rendered, bigger than a visually-hidden 1px box, and not parked off-canvas (closed menus).
  const shown = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse") return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.right > 0 && r.left < vw;
  };
  // Solid background behind an element, or null over an image or gradient.
  const backgroundOf = (el) => {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== "none") return null;
      const c = parse(s.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let bg = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) bg = blend(layers[i], bg);
    return bg;
  };

  // Counts are text blocks; *Chars weight them by length, so a short label counts less than a paragraph.
  const text = { total: 0, small: 0, measured: 0, lowContrast: 0, hidden: 0, chars: 0, smallChars: 0, measuredChars: 0, lowContrastChars: 0, smallSamples: [], contrastSamples: [] };
  const skip = "script,style,noscript,template,svg,head,title,option";
  for (const el of document.body ? document.body.querySelectorAll("*") : []) {
    if (el.closest(skip)) continue;
    let own = "";
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    if (!clean(own)) continue;
    if (!shown(el)) continue;
    if (opacityOf(el) < 0.1) { text.hidden++; continue; }
    const s = getComputedStyle(el);
    const size = parseFloat(s.fontSize);
    const chars = clean(own).length;
    text.total++;
    text.chars += chars;
    if (size < 12) {
      text.small++;
      text.smallChars += chars;
      if (text.smallSamples.length < 5) text.smallSamples.push({ text: short(own), detail: size + "px" });
    }
    const bg = backgroundOf(el);
    const fg = parse(s.color);
    if (!bg || !fg) continue;
    text.measured++;
    text.measuredChars += chars;
    const bold = parseInt(s.fontWeight, 10) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const r = ratio(blend(fg, bg), bg);
    if (r < (large ? 3 : 4.5)) {
      text.lowContrast++;
      text.lowContrastChars += chars;
      if (text.contrastSamples.length < 5) text.contrastSamples.push({ text: short(own), detail: r.toFixed(2) + ":1" });
    }
  }

  // WCAG 2.5.8: a target passes at 24×24px, or when smaller but spaced so a 24px circle
  // on its centre touches no other target (nor another small target's circle).
  const tapTargets = { total: 0, small: 0, samples: [] };
  const found = [];
  for (const el of document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [role=button], summary")) {
    if (!shown(el) || opacityOf(el) < 0.1) continue;
    const s = getComputedStyle(el);
    // Links inside a sentence are exempt (the inline exception).
    if (el.tagName === "A" && s.display === "inline" && el.parentElement && clean(el.parentElement.textContent).length > clean(el.textContent).length + 20) continue;
    // Nested targets (a button inside a link) count once, as the outer one.
    if (found.some((f) => f.el.contains(el))) continue;
    const r = el.getBoundingClientRect();
    const box = { left: r.left, right: r.right, top: r.top + scrollY, bottom: r.bottom + scrollY };
    found.push({ el, box, cx: (box.left + box.right) / 2, cy: (box.top + box.bottom) / 2, undersized: r.width < 24 || r.height < 24 });
  }
  const distToBox = (x, y, b) => Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));
  for (const t of found) {
    tapTargets.total++;
    if (!t.undersized) continue;
    const crowded = found.some((o) => o !== t && (o.undersized ? Math.hypot(o.cx - t.cx, o.cy - t.cy) < 24 : distToBox(t.cx, t.cy, o.box) < 12));
    if (!crowded) continue;
    tapTargets.small++;
    const w = Math.round(t.box.right - t.box.left), h = Math.round(t.box.bottom - t.box.top);
    if (tapTargets.samples.length < 5) tapTargets.samples.push({ text: short(t.el.textContent || t.el.getAttribute("aria-label") || t.el.tagName.toLowerCase()), detail: w + "×" + h + "px, crowded" });
  }

  const inFirstScreen = (el) => { const r = el.getBoundingClientRect(); return shown(el) && opacityOf(el) >= 0.1 && r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0; };
  const h1 = Array.from(document.querySelectorAll("h1")).find(inFirstScreen) || null;
  const ctaWords = /\\b(call|text|quote|book|contact|get started|schedule|estimate|free|hire|start)\\b/i;
  const cta = Array.from(document.querySelectorAll("a[href], button")).find((el) => {
    if (!inFirstScreen(el)) return false;
    const href = el.getAttribute("href") || "";
    return /^(tel|sms|mailto):/i.test(href) || ctaWords.test(clean(el.textContent) + " " + (el.getAttribute("aria-label") || ""));
  }) || null;

  const images = { total: 0, broken: 0, missingAlt: 0, samples: [] };
  for (const img of document.querySelectorAll("img")) {
    if (!shown(img)) continue;
    images.total++;
    const src = img.currentSrc || img.getAttribute("src") || "";
    if (img.complete && img.naturalWidth === 0 && src) {
      images.broken++;
      if (images.samples.length < 5) images.samples.push({ text: src.split("/").pop().slice(0, 60), detail: "broken" });
    }
    if (!img.hasAttribute("alt")) {
      images.missingAlt++;
      if (images.samples.length < 5) images.samples.push({ text: src.split("/").pop().slice(0, 60), detail: "no alt" });
    }
  }

  const meta = document.querySelector('meta[name="viewport" i]');
  return {
    viewport: { width: vw, height: vh },
    docWidth: document.documentElement.scrollWidth,
    docHeight: document.documentElement.scrollHeight,
    viewportMeta: meta ? meta.getAttribute("content") : null,
    text,
    tapTargets,
    aboveFold: { h1: !!h1, h1Text: h1 ? short(h1.textContent) : null, cta: !!cta, ctaText: cta ? short(cta.textContent || cta.getAttribute("aria-label")) : null },
    images,
  };
})()`;

export interface VisualCapture {
  url: string;
  score: VisualScore;
  metrics: VisualMetrics;
  // JPEG of the first screen, base64.
  screenshot: string;
  screenshotSha256: string;
  // False when the network never went quiet (captured anyway, after the timeout).
  networkIdle: boolean;
  // HTTP status of the page and requests that failed while loading it. Either being off
  // can mean the capture shows a broken page rather than the real one.
  status: number | null;
  failedRequests: number;
  ms: number;
}

export async function capturePage(browser: Browser, url: string): Promise<VisualCapture> {
  const started = Date.now();
  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    const network = trackNetwork(page);
    let networkIdle = true;
    let status: number | null = null;
    try {
      status = (await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS }))?.status() ?? null;
    } catch (err) {
      // Pages that poll forever never reach network idle; measure what loaded.
      if (!(err instanceof Error && err.name === "TimeoutError")) throw err;
      networkIdle = false;
    }
    await page.addStyleTag({ content: FREEZE_CSS });
    await page.evaluate(SCROLL_PASS_SCRIPT);
    networkIdle = (await network.waitQuiet()) && networkIdle;
    await page.waitForTimeout(SETTLE_MS);

    const metrics = (await page.evaluate(VISUAL_METRICS_SCRIPT)) as VisualMetrics;
    const image = await page.screenshot({ type: "jpeg", quality: 60, animations: "disabled", caret: "hide", scale: "css" });
    return {
      url,
      score: scoreVisual(metrics),
      metrics,
      screenshot: image.toString("base64"),
      screenshotSha256: createHash("sha256").update(image).digest("hex"),
      networkIdle,
      status,
      failedRequests: network.failed(),
      ms: Date.now() - started,
    };
  } finally {
    await context.close();
  }
}

export type VisualResult = VisualCapture | { url: string; error: string };

const errorText = (err: unknown) => (err instanceof Error ? err.message.split("\n")[0] : String(err));

// Captures every URL; a page that fails gets an error, not a throw. Locally, pages share
// one browser, two at a time. Serverless Chromium runs --single-process, where closing a
// page's context takes the whole browser down, so there each page gets its own browser,
// one at a time. Either way every capture starts from the same fresh state.
// With a deadline (epoch ms), no capture starts after it, and only URLs that were
// attempted come back.
export async function captureSite(
  urls: string[],
  concurrency = 2,
  browser?: Browser,
  deadline = Number.POSITIVE_INFINITY,
): Promise<VisualResult[]> {
  const results: VisualResult[] = new Array(urls.length);
  const done = () => results.filter((r) => r !== undefined);
  if (!browser && isServerless()) {
    for (let i = 0; i < urls.length && Date.now() < deadline; i++) {
      let b: Browser | null = null;
      try {
        b = await launchBrowser();
        results[i] = await capturePage(b, urls[i]);
      } catch (err) {
        results[i] = { url: urls[i], error: errorText(err) };
      } finally {
        await b?.close().catch(() => {});
      }
    }
    return done();
  }

  const own = !browser;
  const b = browser ?? (await launchBrowser());
  try {
    let next = 0;
    const worker = async () => {
      while (next < urls.length && Date.now() < deadline) {
        const i = next++;
        try {
          results[i] = await capturePage(b, urls[i]);
        } catch (err) {
          results[i] = { url: urls[i], error: errorText(err) };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
    return done();
  } finally {
    if (own) await b.close();
  }
}
