import type { NextConfig } from "next";

// Only these two functions launch headless Chromium (about 100 MB, copied into each function that
// carries it). Every other route calls them over HTTP (see lib/self-call.ts) and has Chromium
// excluded, because Vercel counts the size of every function of every stored deployment against
// Functions Storage.
const BROWSER_ROUTES = ["/api/cron/crawl", "/api/cron/outreach"];
const BROWSER_FILES = ["./node_modules/@sparticuz/chromium/**", "./node_modules/playwright-core/**"];
// Routes that import the crawler or research code but never launch the browser themselves.
const NO_BROWSER_ROUTES = ["/performance", "/blueprints", "/audit", "/outreach", "/outreach/[id]", "/api/audit/export", "/api/crawl"];

const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Nothing here should ever be framed by another site.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Loaded from node_modules at runtime rather than bundled.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium", "imapflow"],
  // Both packages read files from disk at runtime (the Chromium binary, playwright's
  // browsers.json), which tracing can't see, so ship them whole.
  outputFileTracingIncludes: Object.fromEntries(BROWSER_ROUTES.map((route) => [route, BROWSER_FILES])),
  outputFileTracingExcludes: Object.fromEntries(NO_BROWSER_ROUTES.map((route) => [route, BROWSER_FILES])),
};

export default nextConfig;
