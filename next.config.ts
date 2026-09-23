import type { NextConfig } from "next";

// Routes that can run a crawl, which launches headless Chromium for visual scoring.
const CRAWL_ROUTES = ["/api/crawl", "/performance", "/blueprints"];

const nextConfig: NextConfig = {
  // Loaded from node_modules at runtime rather than bundled.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  // The serverless Chromium binary is read from disk, so tracing can't see it.
  outputFileTracingIncludes: Object.fromEntries(
    CRAWL_ROUTES.map((route) => [route, ["./node_modules/@sparticuz/chromium/bin/**"]]),
  ),
};

export default nextConfig;
