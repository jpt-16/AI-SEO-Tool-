// Crawl client sites and store on-page data in Supabase. Safe to re-run: pages are
// upserted by (site, page_key), so each run refreshes rows instead of adding more.
//
//   npm run crawl                          # every site in the sites table
//   npm run crawl -- cloverdownsdetailing.com
//   VISUAL_CAPTURE=off npm run crawl         # skip the headless-browser step
import { runSiteCrawl } from "../src/lib/crawl-run";
import { listSites } from "../src/lib/sites";

async function main() {
  const filter = process.argv[2]?.toLowerCase();
  const sites = (await listSites()).filter((s) => !filter || s.domain === filter || s.id === filter);
  if (sites.length === 0) {
    console.error(filter ? `No site matches "${filter}".` : "No sites in the sites table.");
    process.exit(1);
  }

  let failed = false;
  for (const site of sites) {
    const started = Date.now();
    console.log(`Crawling ${site.domain}…`);
    const result = await runSiteCrawl(site.id, "script");
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (result.ok) {
      console.log(`  ${result.pagesCrawled} pages saved, ${result.pagesFailed} failed (${seconds}s)`);
      if (result.visualError) console.log(`  Visual: ${result.visualError}`);
      else if (result.visualPages !== undefined) console.log(`  Visual: ${result.visualPages} pages scored, ${result.visualFailed} failed`);
    } else {
      failed = true;
      console.error(`  Failed: ${result.error}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
