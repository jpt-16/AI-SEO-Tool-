import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import { aiCrawlerAccess, checkAnswers, checkLlmsTxt, isQuestionHeading, parseRobotsGroups, scoreAnswer } from "./aeo";

const pages = ["https://site.com/", "https://site.com/services", "https://site.com/blog/post"];
const status = (robots: string | null) => Object.fromEntries(aiCrawlerAccess(robots, pages).map((a) => [a.agent, a.status]));

describe("aiCrawlerAccess", () => {
  it("allows everything with no robots.txt or an open one", () => {
    expect(new Set(Object.values(status(null)))).toEqual(new Set(["allowed"]));
    expect(new Set(Object.values(status("User-agent: *\nAllow: /\nDisallow: /api/")))).toEqual(new Set(["allowed"]));
  });

  it("uses a crawler's own group over *, and flags site-wide and partial blocks", () => {
    const robots = [
      "User-agent: *",
      "Allow: /",
      "",
      "User-agent: GPTBot",
      "User-agent: anthropic-ai",
      "Disallow: /",
      "",
      "User-agent: ClaudeBot",
      "Disallow: /blog/",
      "",
      "User-agent: PerplexityBot",
      "Allow: /",
    ].join("\n");
    expect(status(robots)).toEqual({
      GPTBot: "blocked",
      "anthropic-ai": "blocked",
      ClaudeBot: "partial",
      "Google-Extended": "allowed",
      PerplexityBot: "allowed",
    });
    const claude = aiCrawlerAccess(robots, pages).find((a) => a.agent === "ClaudeBot")!;
    expect(claude).toMatchObject({ namedGroup: true, blockedPages: ["https://site.com/blog/post"] });
  });

  it("applies a blanket * block to crawlers without their own group", () => {
    expect(status("User-agent: *\nDisallow: /").ClaudeBot).toBe("blocked");
  });

  it("groups consecutive user-agent lines", () => {
    expect(parseRobotsGroups("User-agent: A\nUser-agent: B\nDisallow: /x\nUser-agent: C\nAllow: /")).toEqual([
      { agents: ["a", "b"], allow: [], disallow: ["/x"] },
      { agents: ["c"], allow: ["/"], disallow: [] },
    ]);
  });
});

describe("checkLlmsTxt", () => {
  it("reads title, summary, sections and links", () => {
    const body = "# Clover Downs\n\n> Mobile detailing on the North Shore.\n\n## Pages\n- [Home](https://x.com/): start\n- [Hamilton](https://x.com/h)\n";
    expect(checkLlmsTxt("https://x.com/llms.txt", { statusCode: 200, contentType: "text/plain", body }, true)).toMatchObject({
      present: true,
      title: "Clover Downs",
      hasSummary: true,
      sections: 1,
      links: 2,
      fullVersion: true,
      issues: [],
    });
  });

  it("treats a 200 HTML page (a soft 404) and a 404 as missing", () => {
    const soft = checkLlmsTxt("u", { statusCode: 200, contentType: "text/html", body: "<!doctype html><p>Not found" }, false);
    expect(soft).toMatchObject({ present: false, issues: ["llms.txt returns a web page, not a text file."] });
    expect(checkLlmsTxt("u", { statusCode: 404, contentType: null, body: "" }, false).issues).toEqual(["No llms.txt at the site root."]);
  });
});

describe("scoreAnswer", () => {
  it("gives full marks to a short, direct, self-contained answer", () => {
    const item = scoreAnswer("details", "How long does it take?", "Most details take three to four hours. Larger vehicles or heavy pet hair can add an hour, and we tell you up front.");
    expect(item).toMatchObject({ score: 100, issues: [] });
  });

  it("flags answers buried in long paragraphs, long first sentences and pronoun starts", () => {
    const long = Array.from({ length: 130 }, (_, i) => `word${i}`).join(" ");
    expect(scoreAnswer("heading", "Q?", long).issues[0]).toMatch(/buried in a 130-word paragraph/);
    const pronoun = scoreAnswer("inline", "Who owns my website?", "It depends on four things: the domain, the hosting, the files and the content.");
    expect(pronoun.score).toBe(70);
    expect(pronoun.issues).toEqual(['Starts with "It", so it doesn\'t stand alone when quoted.']);
    expect(scoreAnswer("heading", "Q?", "").score).toBe(0);
  });
});

describe("checkAnswers", () => {
  it("finds details, dt/dd, question headings, bold-question paragraphs and FAQ schema", () => {
    const html = `<body><header><nav><a href="/">Home</a></nav></header><main>
      <h1>Mobile <span>detailing</span></h1><p>By Jake</p>
      <p>Clover Downs details cars in your driveway across Beverly and the North Shore, inside and out.</p>
      <h2>What good looks like</h2><p>Not a question, so it is ignored.</p>
      <h2>How much does it cost?</h2><p>Interior details start at $180. The price depends on size and condition.</p>
      <details><summary>Do you need water?</summary><p>Yes, an outdoor tap within reach of the car.</p></details>
      <details><summary>Choose one or more</summary><label>Form field</label></details>
      <dl><dt>Do I need a driveway?</dt><dd>No. Any spot where the car can be reached works, including a street space.</dd></dl>
      <p><strong>Is there a deposit?</strong> No deposit. You pay on the day, once you have seen the car.</p>
    </main></body>`;
    const ld = [{ "@type": "FAQPage", mainEntity: [
      { "@type": "Question", name: "Do you need water?", acceptedAnswer: { text: "Yes, a tap." } },
      { "@type": "Question", name: "Do you work in the rain?", acceptedAnswer: { text: "Under cover, yes. Otherwise we move the booking to the next dry day." } },
    ] }];
    const result = checkAnswers(load(html), ld);
    expect(result.items.map((i) => [i.source, i.question])).toEqual([
      ["lead", "Mobile detailing"],
      ["details", "Do you need water?"],
      ["definition", "Do I need a driveway?"],
      ["heading", "How much does it cost?"],
      ["inline", "Is there a deposit?"],
      ["schema", "Do you work in the rain?"],
    ]);
    expect(result.questions).toBe(5);
    expect(result.faqSchema).toBe(true);
    expect(result.items[0].answerStart).toMatch(/^Clover Downs details cars/);
    expect(result.score).toBeGreaterThan(80);
  });

  it("returns a null score when there's nothing to judge", () => {
    expect(checkAnswers(load("<body><div>Logo</div></body>"), [])).toMatchObject({ score: null, questions: 0 });
  });

  it("only treats asking or how-to headings as questions", () => {
    expect(isQuestionHeading("What good looks like")).toBe(false);
    expect(isQuestionHeading("Who owns your website? It is four things")).toBe(true);
    expect(isQuestionHeading("How to get salt stains out")).toBe(true);
  });
});
