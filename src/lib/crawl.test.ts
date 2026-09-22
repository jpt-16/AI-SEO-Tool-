import { describe, expect, it } from "vitest";
import { crawlSite, extractPage, isAllowed, pageKey, parseRobots, parseSitemap } from "./crawl";
import { missingQueryWords } from "./match";

describe("pageKey", () => {
  it("normalizes the variants Search Console reports for one page", () => {
    expect(pageKey("https://www.cloverdownsdetailing.com/mobile-detailing/hamilton")).toBe(
      "cloverdownsdetailing.com/mobile-detailing/hamilton",
    );
    expect(pageKey("https://cloverdownsdetailing.com/mobile-detailing/hamilton/")).toBe(
      "cloverdownsdetailing.com/mobile-detailing/hamilton",
    );
    expect(pageKey("https://www.Example.com/Services/?a=1#top")).toBe("example.com/Services");
    expect(pageKey("https://example.com")).toBe("example.com/");
    expect(pageKey("http://example.com:443/")).toBe("example.com/");
  });
});

const PAGE = `<!doctype html><html><head>
  <title>Mobile Detailing in Hamilton, MA | Clover Downs</title>
  <meta name="Description" content="  Interior details   and hand washes. ">
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"AutoWash"},{"@type":["LocalBusiness","Organization"],"address":{"@type":"PostalAddress"}}]}</script>
  <script type="application/ld+json">{ not json</script>
</head><body>
  <svg><title>icon</title></svg>
  <h1>Mobile detailing — Hamilton<span>Your car, detailed in your driveway</span></h1>
  <h2>Services</h2><h2>How it <em>works</em></h2>
  <p>We come to you. Two hour details!</p>
  <script>var hidden = "not counted words here";</script>
  <div hidden>also not counted</div>
  <a href="/">Home</a>
  <a href="/#quote">Quote</a>
  <a href="#top">Top</a>
  <a href="/mobile-detailing/hamilton">Self</a>
  <a href="https://www.cloverdownsdetailing.com/interior-car-detailing">Interior</a>
  <a href="/brochure.pdf">PDF</a>
  <a href="https://instagram.com/x">IG</a>
  <a href="tel:+15550000">Call</a>
</body></html>`;

describe("extractPage", () => {
  const page = extractPage(PAGE, "https://cloverdownsdetailing.com/mobile-detailing/hamilton");

  it("reads title, meta description and headings", () => {
    expect(page.title).toBe("Mobile Detailing in Hamilton, MA | Clover Downs");
    expect(page.metaDescription).toBe("Interior details and hand washes.");
    expect(page.h1).toEqual(["Mobile detailing — Hamilton Your car, detailed in your driveway"]);
    expect(page.h2).toEqual(["Services", "How it works"]);
  });

  it("counts visible words only", () => {
    // h1 (9; the dash isn't a word) + h2s (4) + paragraph (7) + link text (8) = 28;
    // scripts, [hidden] and svg text are excluded
    expect(page.wordCount).toBe(28);
  });

  it("counts links to other pages on the same site, www or not", () => {
    // "/", "/#quote", interior (www), brochure.pdf; not #top, self, instagram, tel
    expect(page.internalLinkCount).toBe(4);
    expect(page.internalLinks.sort()).toEqual([
      "https://cloverdownsdetailing.com/",
      "https://www.cloverdownsdetailing.com/interior-car-detailing",
    ]);
  });

  it("keeps JSON-LD, including invalid blocks, and lists top-level types", () => {
    expect(page.jsonLd).toHaveLength(2);
    expect(page.jsonLd[1]).toMatchObject({ "@error": "Invalid JSON-LD" });
    // PostalAddress is nested inside LocalBusiness, so it isn't a page-level type
    expect(page.schemaTypes).toEqual(["AutoWash", "LocalBusiness", "Organization"]);
  });

  it("handles a page with no title, meta or body text", () => {
    expect(extractPage("<html><body></body></html>", "https://a.com/")).toMatchObject({
      title: null,
      metaDescription: null,
      h1: [],
      wordCount: 0,
      internalLinkCount: 0,
    });
  });
});

describe("sitemaps and robots.txt", () => {
  it("reads url sets and sitemap indexes", () => {
    expect(parseSitemap(`<urlset xmlns="x"><url><loc> https://a.com/x </loc></url></urlset>`)).toEqual({
      pages: ["https://a.com/x"],
      sitemaps: [],
    });
    expect(parseSitemap(`<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>`).sitemaps).toEqual([
      "https://a.com/s1.xml",
    ]);
  });

  it("applies only the * group, with the longest matching rule winning", () => {
    const rules = parseRobots(
      "User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nAllow: /private/ok\n# comment\nSitemap: https://a.com/sitemap.xml",
    );
    expect(rules.sitemaps).toEqual(["https://a.com/sitemap.xml"]);
    expect(isAllowed(rules, new URL("https://a.com/"))).toBe(true);
    expect(isAllowed(rules, new URL("https://a.com/private/x"))).toBe(false);
    expect(isAllowed(rules, new URL("https://a.com/private/ok/1"))).toBe(true);
  });
});

describe("crawlSite", () => {
  const html = (body: string) => `<html><head><title>t</title></head><body>${body}</body></html>`;
  const site: Record<string, { status?: number; body: string; type?: string; redirect?: string }> = {
    "https://a.com/robots.txt": { body: "User-agent: *\nDisallow: /admin\nSitemap: https://a.com/sitemap.xml", type: "text/plain" },
    "https://a.com/sitemap.xml": {
      body: "<urlset><url><loc>https://a.com</loc></url><url><loc>https://a.com/old</loc></url><url><loc>https://a.com/gone</loc></url></urlset>",
      type: "application/xml",
    },
    "https://a.com/": { body: html('<a href="/about">a</a><a href="/admin">x</a><a href="https://www.a.com/about/">dup</a>') },
    "https://a.com/about": { body: html('<a href="/deep">d</a>') },
    "https://a.com/deep": { body: html("deep page") },
    "https://a.com/old": { body: "", redirect: "https://a.com/about" },
    "https://a.com/gone": { status: 404, body: "nope" },
  };
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    const entry = site[url];
    if (!entry) return Object.assign(new Response("missing", { status: 404, headers: { "content-type": "text/html" } }), { url });
    const final = entry.redirect ? site[entry.redirect] : entry;
    const res = new Response(final.body, { status: final.status ?? 200, headers: { "content-type": final.type ?? "text/html" } });
    Object.defineProperty(res, "url", { value: entry.redirect ?? url });
    return res;
  }) as typeof fetch;

  it("seeds from the sitemap, follows links, dedupes redirects and respects robots.txt", async () => {
    const pages = await crawlSite("https://a.com", { fetchImpl, concurrency: 2 });
    const byKey = Object.fromEntries(pages.map((p) => [pageKey(p.url), p]));
    expect(Object.keys(byKey).sort()).toEqual(["a.com/", "a.com/about", "a.com/deep", "a.com/gone"]);
    expect(byKey["a.com/"].inSitemap).toBe(true);
    // /old redirects to /about and is in the sitemap, so /about counts as listed
    expect(byKey["a.com/about"].inSitemap).toBe(true);
    expect(byKey["a.com/deep"].inSitemap).toBe(false);
    expect(byKey["a.com/gone"]).toMatchObject({ statusCode: 404, error: "HTTP 404" });
  });

  it("stops at maxPages", async () => {
    const pages = await crawlSite("https://a.com", { fetchImpl, maxPages: 1 });
    expect(pages).toHaveLength(1);
  });
});

describe("missingQueryWords", () => {
  const title = "Mobile Car Detailing in Hamilton, MA | Clover Downs";

  it("ignores stopwords, case and simple plurals", () => {
    expect(missingQueryWords("mobile car detailing near me", title)).toEqual([]);
    expect(missingQueryWords("cars detailing hamilton", title)).toEqual([]);
  });

  it("returns the query words the title lacks", () => {
    expect(missingQueryWords("ceramic coating hamilton ma", title)).toEqual(["ceramic", "coating"]);
    expect(missingQueryWords("interior detailing", null)).toEqual(["interior", "detailing"]);
  });
});
