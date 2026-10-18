// The one-pager as a standalone HTML page, for rendering to a PDF attachment. It mirrors the
// on-screen sheet in OnePagerEditor.tsx; keep the two in step.
import { MONOGRAM_CUTS, MONOGRAM_OUTLINE } from "../components/Monogram";
import { FREE_VALUE_ITEMS, OUTREACH, SOLUTION_ITEMS, type OnePagerSheetData } from "./outreach-sheet";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M5 12v9h14v-9"/><path d="M12 8c-1.5-4-6-3.5-5 0 .5 1.5 5 0 5 0Z"/><path d="M12 8c1.5-4 6-3.5 5 0-.5 1.5-5 0-5 0Z"/>',
};
const icon = (name: keyof typeof ICONS, size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const CSS = `
@page { size: letter; margin: 0; }
* { box-sizing: border-box; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { background: #161826; }
body { width: 8.5in; height: 11in; color: #ededf1; font-family: Inter, "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.4; }
.sheet { width: 8.5in; height: 11in; padding: 0.4in 0.6in 0.3in; display: flex; flex-direction: column; gap: 10px; overflow: hidden; }
.top { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(237,237,241,.14); padding-bottom: 12px; }
.brand { display: flex; align-items: center; gap: 12px; font-size: 17px; }
.tag { font-size: 9px; letter-spacing: .22em; text-transform: uppercase; color: #9494a6; }
.eyebrow { font-size: 10.5px; letter-spacing: .2em; text-transform: uppercase; color: #b7afe8; margin-bottom: 8px; }
.prep { display: grid; grid-template-columns: 1fr 170px 150px; gap: 12px; }
.box { background: rgba(255,255,255,.04); border-bottom: 1px solid rgba(237,237,241,.28); padding: 6px 12px; font-size: 14px; min-height: 30px; }
.cap { font-size: 8.5px; letter-spacing: .2em; text-transform: uppercase; color: #9494a6; margin-top: 5px; }
.card { border: 1px solid rgba(237,237,241,.28); border-radius: 12px; padding: 14px; background: rgba(255,255,255,.03); }
.card.accent { border-color: #9184d9; background: linear-gradient(135deg, rgba(43,38,80,.7), rgba(43,38,80,.2)); }
.card h2 { display: flex; justify-content: space-between; align-items: center; font-size: 19px; font-weight: 500; margin-bottom: 10px; }
.card h2 .n { font-size: 10.5px; letter-spacing: .2em; color: #b7afe8; margin-right: 12px; }
.card h2 .ic { color: #b7afe8; display: flex; }
.row { display: grid; grid-template-columns: 150px 1fr; gap: 12px; align-items: start; }
.row + .row { margin-top: 6px; }
.lab { font-size: 11px; color: #9494a6; padding-top: 6px; }
.field { background: rgba(255,255,255,.04); border-bottom: 1px solid rgba(237,237,241,.28); padding: 6px 12px; font-size: 12px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; min-height: 28px; }
.field.big { border: 1px solid rgba(237,237,241,.28); border-radius: 8px; min-height: 3.25rem; }
.note { font-size: 11px; color: #9494a6; margin-bottom: 8px; }
.checks { display: grid; gap: 6px 24px; margin-bottom: 8px; }
.checks.three { grid-template-columns: repeat(3, 1fr); }
.checks.two { grid-template-columns: repeat(2, 1fr); }
.check { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
.cb { width: 15px; height: 15px; border-radius: 4px; border: 1.5px solid #9184d9; display: flex; align-items: center; justify-content: center; flex: none; }
.cb.on { background: #9184d9; color: #161826; }
.price { margin-top: 8px; font-size: 11px; color: #9494a6; }
.nostrings { margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(237,237,241,.28); font-size: 12px; line-height: 1.5; color: #d3d3dc; }
.nostrings b { color: #ededf1; font-weight: 600; }
.sig { display: block; margin-top: 5px; font-size: 9.5px; letter-spacing: .18em; text-transform: uppercase; color: #9494a6; }
.foot { margin-top: auto; display: flex; justify-content: space-between; border-top: 1px solid rgba(237,237,241,.14); padding-top: 10px; font-size: 9.5px; letter-spacing: .16em; text-transform: uppercase; color: #9494a6; }
`;

const check = (label: string, on: boolean) =>
  `<div class="check"><span class="cb${on ? " on" : ""}">${on ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' : ""}</span>${esc(label)}</div>`;

const row = (label: string, value: string) => `<div class="row"><span class="lab">${esc(label)}</span><div class="field">${esc(value)}</div></div>`;

export function sheetHtml(input: { business: string; dateText: string; sheet: OnePagerSheetData }): string {
  const { sheet } = input;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A quick look at ${esc(input.business)}</title><style>${CSS}</style></head><body><div class="sheet">
<div class="top"><span class="brand"><svg height="22" width="${(22 * 96) / 81}" viewBox="0 0 96 81"><mask id="m" maskUnits="userSpaceOnUse" x="-4" y="-4" width="104" height="94"><path d="${MONOGRAM_OUTLINE}" fill="#fff"/><path d="${MONOGRAM_CUTS}" fill="#000"/></mask><g mask="url(#m)"><path d="${MONOGRAM_OUTLINE}" fill="#ededf1"/></g></svg>Builds Co.</span><span class="tag">A quick look, made for you</span></div>
<div><div class="eyebrow">Prepared for</div><div class="prep">
<div><div class="box">${esc(input.business)}</div><div class="cap">Business name</div></div>
<div><div class="box">${esc(sheet.owner_name ?? "")}</div><div class="cap">Owner</div></div>
<div><div class="box">${esc(input.dateText)}</div><div class="cap">Date</div></div></div></div>
<section class="card"><h2><span><span class="n">01</span>Show Your Research</span><span class="ic">${icon("search", 26)}</span></h2>
${row("Google listing", sheet.google_listing)}${row("Website & phone", sheet.website_and_phone)}${row("Reviews & local search", sheet.reviews_and_local_search)}</section>
<section class="card"><h2><span><span class="n">02</span>Their Problem</span><span class="ic">${icon("alert", 26)}</span></h2>
<div class="note">What this may mean for your customers</div><div class="field big">${esc(sheet.problem)}</div></section>
<section class="card"><h2><span><span class="n">03</span>Your Solution</span><span class="ic">${icon("bulb", 26)}</span></h2>
<div class="checks three">${SOLUTION_ITEMS.map((i) => check(i.label, sheet.solution[i.key])).join("")}</div>
<div class="field big" style="min-height:0">${esc(sheet.solution_note)}</div><div class="price">${esc(OUTREACH.price)}</div></section>
<section class="card accent"><h2><span><span class="n">04</span>Free Value</span><span class="ic">${icon("gift", 28)}</span></h2>
<div class="checks two">${FREE_VALUE_ITEMS.map((i) => check(i.label, sheet.free_value[i.key])).join("")}</div>
${row("Or something else", sheet.free_value_other ?? "")}
<div class="nostrings"><b>No strings.</b> Reply to this message or call <b>${esc(OUTREACH.phone)}</b>, or visit <b>${esc(OUTREACH.contactUrl)}</b>. I reply personally within one business day.<span class="sig">${esc(OUTREACH.sender)} · ${esc(OUTREACH.role)}</span></div></section>
<div class="foot"><span>JT Builds Co. · ${esc(OUTREACH.location)}</span><span>${esc(OUTREACH.site)}</span><span>${esc(OUTREACH.handle)}</span></div>
</div></body></html>`;
}
