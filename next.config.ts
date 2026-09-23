import type { NextConfig } from "next";

// Routes that can run a crawl, which launches headless Chromium for visual scoring.
const CRAWL_ROUTES = ["/api/crawl", "/api/cron/crawl", "/performance", "/blueprints"];

const nextConfig: NextConfig = {
  // Loaded from node_modules at runtime rather than bundled.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  // Both packages read files from disk at runtime (the Chromium binary, playwright's
  // browsers.json), which tracing can't see, so ship them whole.
  outputFileTracingIncludes: Object.fromEntries(
    CRAWL_ROUTES.map((route) => [route, ["./node_modules/@sparticuz/chromium/**", "./node_modules/playwright-core/**"]]),
  ),
};

export default nextConfig;
