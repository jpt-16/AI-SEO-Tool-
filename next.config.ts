import type { NextConfig } from "next";

// Routes that can run a crawl, which launches headless Chromium for visual scoring.
const CRAWL_ROUTES = ["/api/crawl", "/api/cron/crawl", "/performance", "/blueprints", "/audit"];

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
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  // Both packages read files from disk at runtime (the Chromium binary, playwright's
  // browsers.json), which tracing can't see, so ship them whole.
  outputFileTracingIncludes: Object.fromEntries(
    CRAWL_ROUTES.map((route) => [route, ["./node_modules/@sparticuz/chromium/**", "./node_modules/playwright-core/**"]]),
  ),
};

export default nextConfig;
