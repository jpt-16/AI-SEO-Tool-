import { describe, expect, it } from "vitest";
import { ISSUE_TYPES, type AuditIssue } from "./audit";
import { auditBrief, FIX } from "./audit-export";

const issue = (type: AuditIssue["type"], url: string | null, impressions: number, detail = "detail"): AuditIssue => ({
  type,
  pageKey: url ? url.replace("https://", "") : "",
  url,
  detail,
  impressions,
  detectedAt: "2026-09-23T13:00:00Z",
});

const brief = (issues: AuditIssue[]) =>
  auditBrief({ site: { name: "Panda Sports", domain: "www.panda.com" }, issues, crawledAt: "2026-09-23T13:00:00Z", generatedAt: new Date("2026-09-24T12:00:00Z") });

describe("auditBrief", () => {
  it("has a fix for every issue type", () => {
    expect(Object.keys(FIX).sort()).toEqual(Object.keys(ISSUE_TYPES).sort());
  });

  it("puts instructions first, then site-wide issues, then pages by severity and traffic", () => {
    const md = brief([
      issue("meta_long", "https://www.panda.com/shop", 40, "170 characters."),
      issue("title_long", "https://www.panda.com/about", 2, "64 characters: About us"),
      issue("page_error", "https://www.panda.com/old", 0, "HTTP 404"),
      issue("llms_txt", null, 0, "No llms.txt at the site root."),
      issue("visual_failed", "https://www.panda.com/faq", 0, "Timed out"),
    ]);
    const headings = md.split("\n").filter((l) => l.startsWith("#"));
    expect(headings).toEqual(["# SEO fixes for Panda Sports (www.panda.com)", "## Instructions", "## Whole site", "## /old", "## /about", "## /shop"]);
    expect(md).toContain("4 open issues: 1 high, 1 medium, 2 low.");
    expect(md).toContain("You're working in the codebase for https://www.panda.com.");
    expect(md).toContain("- **[MEDIUM] Title over 60 characters.** Now: 64 characters: About us\n  Fix: Shorten the <title> to 60 characters or fewer.");
    // A failed capture is the tool's problem, not the site's.
    expect(md).not.toContain("/faq");
  });

  it("says so when there's nothing to fix", () => {
    expect(brief([])).toContain("No open issues. Nothing to change.");
  });
});
