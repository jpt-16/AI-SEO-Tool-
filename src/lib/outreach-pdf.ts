import "server-only";
import { sheetHtml } from "./outreach-html";
import type { OnePagerSheetData } from "./outreach-sheet";
import { launchBrowser } from "./visual";

// The sheet as a one-page US Letter PDF, drawn by headless Chromium.
export async function renderSheetPdf(input: { business: string; dateText: string; sheet: OnePagerSheetData }): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(sheetHtml(input), { waitUntil: "load" });
    // Long text would spill onto a second page: shrink the whole sheet to keep it to one.
    await page.evaluate(() => {
      const sheet = document.querySelector<HTMLElement>(".sheet");
      if (!sheet || sheet.scrollHeight <= sheet.clientHeight) return;
      const ratio = sheet.clientHeight / sheet.scrollHeight;
      sheet.style.zoom = String(ratio);
      sheet.style.width = `${8.5 / ratio}in`;
      sheet.style.height = `${11 / ratio}in`;
    });
    return Buffer.from(await page.pdf({ format: "Letter", printBackground: true, preferCSSPageSize: true }));
  } finally {
    await browser.close().catch(() => {});
  }
}
