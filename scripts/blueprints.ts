// Ask Claude for one high-leverage title/meta change per page and store it as a blueprint.
//
//   npm run blueprints                                   # every site, pages with > 20 impressions
//   npm run blueprints -- --min-impressions=10 --max-pages=5
//   npm run blueprints -- cloverdownsdetailing.com --dry-run   # list qualifying pages, no API calls
//   npm run blueprints -- --effort=low --recheck        # cheapest depth; re-review unchanged pages
import { DEFAULT_MIN_IMPRESSIONS, runBlueprints } from "../src/lib/blueprints";
import { isEffort, type Effort } from "../src/lib/effort";
import { listSites } from "../src/lib/sites";

function numberFlag(name: string): number | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return undefined;
  const value = Number(arg.split("=")[1]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a non-negative number.`);
  return value;
}

async function main() {
  const filter = process.argv.slice(2).find((a) => !a.startsWith("--"))?.toLowerCase();
  const minImpressions = numberFlag("min-impressions") ?? DEFAULT_MIN_IMPRESSIONS;
  const maxPages = numberFlag("max-pages");
  const dryRun = process.argv.includes("--dry-run");
  const recheck = process.argv.includes("--recheck");
  const effortArg = process.argv.find((a) => a.startsWith("--effort="))?.split("=")[1];
  if (effortArg !== undefined && !isEffort(effortArg)) throw new Error("--effort must be low, medium or high.");
  const effort = effortArg as Effort | undefined;

  const sites = (await listSites()).filter((s) => !filter || s.domain === filter || s.id === filter);
  if (sites.length === 0) {
    console.error(filter ? `No site matches "${filter}".` : "No sites in the sites table.");
    process.exit(1);
  }

  let failed = false;
  for (const site of sites) {
    console.log(`${site.domain}: pages with more than ${minImpressions} impressions${dryRun ? " (dry run)" : ""}`);
    const result = await runBlueprints(site.id, "script", { minImpressions, maxPages, dryRun, effort, recheck });
    for (const o of result.outcomes) {
      console.log(`  ${o.outcome.padEnd(9)} ${o.url}${o.error ? `  (${o.error})` : ""}${o.reason ? `\n            ${o.reason}` : ""}`);
    }
    if (result.note) console.log(`  ${result.note}`);
    if (!result.ok) {
      failed = true;
      console.error(`  Failed: ${result.error}`);
    } else if (!dryRun) {
      console.log(
        `  ${result.pagesAnalyzed} analyzed, ${result.pagesReused} unchanged (reused), ${result.blueprintsCreated} blueprints created, $${result.usage.costUsd.toFixed(2)} (${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens)`,
      );
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
