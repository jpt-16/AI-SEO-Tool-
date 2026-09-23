// Repeatability check for visual scoring: captures each URL several times and
// compares the scores, every raw metric and the screenshot bytes.
//
//   npm run visual-check -- https://cloverdownsdetailing.com/
//   npm run visual-check -- https://jtbuildsco.com/ https://jtbuildsco.com/pricing --runs=3
//
// Needs Chromium: set CHROMIUM_PATH, or run `npx playwright-core install chromium` once.
import { captureSite, launchBrowser, type VisualCapture } from "../src/lib/visual";

function diffPaths(a: unknown, b: unknown, path = ""): string[] {
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
    return Object.is(a, b) ? [] : [`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`];
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
}

async function main() {
  const runsArg = process.argv.find((a) => a.startsWith("--runs="));
  const runs = Math.max(2, Number(runsArg?.split("=")[1] ?? 2));
  const urls = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!urls.length) {
    console.error("Usage: npm run visual-check -- <url> [more urls] [--runs=N]");
    process.exit(1);
  }

  const browser = await launchBrowser();
  let unstable = 0;
  try {
    for (const url of urls) {
      const captures: VisualCapture[] = [];
      for (let i = 0; i < runs; i++) {
        // A fresh browser context each run, same as a real crawl.
        const [result] = await captureSite([url], 1, browser);
        if ("error" in result) throw new Error(`${url}: ${result.error}`);
        captures.push(result);
      }
      const scores = captures.map((c) => c.score.score);
      const metricDiffs = captures.slice(1).flatMap((c) => diffPaths(captures[0].metrics, c.metrics));
      const sameImage = captures.every((c) => c.screenshotSha256 === captures[0].screenshotSha256);
      const spread = Math.max(...scores) - Math.min(...scores);
      if (spread > 1) unstable++;

      console.log(`\n${url}`);
      console.log(`  scores:      ${scores.join(", ")}  (spread ${spread})`);
      console.log(`  checks:      ${captures[0].score.checks.map((c) => `${c.key} ${c.points}/${c.max}`).join(" · ")}`);
      console.log(`  metrics:     ${metricDiffs.length ? `${metricDiffs.length} differences` : "identical"}`);
      metricDiffs.slice(0, 10).forEach((d) => console.log(`               ${d}`));
      console.log(`  screenshot:  ${sameImage ? "byte-identical" : "differs"} (${captures.map((c) => c.screenshotSha256.slice(0, 10)).join(", ")})`);
      console.log(`  network idle ${captures.map((c) => c.networkIdle).join(", ")} · failed requests ${captures.map((c) => c.failedRequests).join(", ")} · ${captures.map((c) => `${(c.ms / 1000).toFixed(1)}s`).join(", ")}`);
    }
  } finally {
    await browser.close();
  }
  console.log(unstable ? `\n${unstable} URL(s) varied by more than 1 point.` : "\nAll scores repeatable (spread ≤ 1).");
  process.exit(unstable ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
