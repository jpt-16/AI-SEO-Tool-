// Visual scoring from measurements taken in a real browser (see visual.ts). Pure, so
// the same metrics always give the same score.

// One fixed viewport for every capture: a common phone size, since most local-service
// searches happen on phones.
export const VISUAL_VIEWPORT = { width: 390, height: 844 } as const;
// Fixed pause after the network goes quiet, before measuring and taking the screenshot.
export const SETTLE_MS = 500;
// Injected before capture so nothing is mid-animation.
export const FREEZE_CSS =
  "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }";

export interface Sample {
  text: string;
  detail: string;
}

// What the in-page script measures (VISUAL_METRICS_SCRIPT in visual.ts).
export interface VisualMetrics {
  viewport: { width: number; height: number };
  docWidth: number;
  docHeight: number;
  viewportMeta: string | null;
  text: {
    // Visible elements that directly hold text, and their characters.
    total: number;
    small: number;
    // Contrast is measurable only over a solid background colour.
    measured: number;
    lowContrast: number;
    hidden: number;
    chars: number;
    smallChars: number;
    measuredChars: number;
    lowContrastChars: number;
    smallSamples: Sample[];
    contrastSamples: Sample[];
  };
  // small = under 24×24px and crowded by a neighbour (WCAG 2.5.8).
  tapTargets: { total: number; small: number; samples: Sample[] };
  aboveFold: { h1: boolean; h1Text: string | null; cta: boolean; ctaText: string | null };
  images: { total: number; broken: number; missingAlt: number; samples: Sample[] };
}

export interface VisualCheck {
  key: "mobile" | "legibility" | "contrast" | "tapTargets" | "aboveFold" | "images";
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface VisualScore {
  score: number;
  checks: VisualCheck[];
}

const share = (ok: number, total: number) => (total === 0 ? 1 : ok / total);
const round1 = (n: number) => Math.round(n * 10) / 10;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pct = (part: number, total: number) => `${Math.round((100 * part) / Math.max(total, 1))}%`;

export function scoreVisual(m: VisualMetrics): VisualScore {
  const overflow = m.docWidth > m.viewport.width + 1;
  const responsiveMeta = !!m.viewportMeta && /width\s*=\s*device-width/i.test(m.viewportMeta);
  const imagesOk = share(m.images.total - m.images.broken, m.images.total);
  const altOk = share(m.images.total - m.images.missingAlt, m.images.total);

  const checks: VisualCheck[] = [
    {
      key: "mobile",
      label: "Fits a phone screen",
      max: 20,
      points: (responsiveMeta ? 10 : 0) + (overflow ? 0 : 10),
      detail: [
        responsiveMeta ? "Responsive viewport tag." : "No width=device-width viewport tag.",
        overflow ? `Page is ${m.docWidth}px wide on a ${m.viewport.width}px screen, so it scrolls sideways.` : "No sideways scrolling.",
      ].join(" "),
    },
    {
      key: "legibility",
      label: "Readable text size",
      max: 15,
      points: 15 * share(m.text.chars - m.text.smallChars, m.text.chars),
      detail: m.text.small
        ? `${pct(m.text.smallChars, m.text.chars)} of the text (${plural(m.text.small, "block")}) is under 12px.`
        : "All text is 12px or larger.",
    },
    {
      key: "contrast",
      label: "Text contrast",
      max: 20,
      points: 20 * share(m.text.measuredChars - m.text.lowContrastChars, m.text.measuredChars),
      detail: m.text.lowContrast
        ? `${pct(m.text.lowContrastChars, m.text.measuredChars)} of the text (${plural(m.text.lowContrast, "block")}) is below WCAG AA contrast.`
        : "All measurable text meets WCAG AA contrast.",
    },
    {
      key: "tapTargets",
      label: "Tap targets",
      max: 15,
      points: 15 * share(m.tapTargets.total - m.tapTargets.small, m.tapTargets.total),
      detail: m.tapTargets.small
        ? `${plural(m.tapTargets.small, "button or link")} of ${m.tapTargets.total} under 24×24px and too close to another.`
        : `All ${m.tapTargets.total} buttons and links are 24×24px or well spaced.`,
    },
    {
      key: "aboveFold",
      label: "First screen",
      max: 20,
      points: (m.aboveFold.h1 ? 10 : 0) + (m.aboveFold.cta ? 10 : 0),
      detail: [
        m.aboveFold.h1 ? "Headline visible without scrolling." : "No H1 visible without scrolling.",
        m.aboveFold.cta
          ? `Call to action visible ("${m.aboveFold.ctaText}").`
          : "Couldn't find a call-to-action button or link (call, book, quote, shop, contact…) on the first screen. Check the screenshot.",
      ].join(" "),
    },
    {
      key: "images",
      label: "Images",
      max: 10,
      points: 5 * imagesOk + 5 * altOk,
      detail: m.images.total
        ? [m.images.broken ? `${plural(m.images.broken, "broken image")}.` : "No broken images.", m.images.missingAlt ? `${m.images.missingAlt} of ${m.images.total} missing alt text.` : "All have alt text."].join(" ")
        : "No images.",
    },
  ].map((c) => ({ ...c, points: round1(c.points) })) as VisualCheck[];

  return { score: Math.round(checks.reduce((sum, c) => sum + c.points, 0)), checks };
}

// WCAG relative luminance and contrast ratio, shared with the in-page script's logic.
export function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const lum = ([r, g, b]: [number, number, number]) => {
    const c = [r, g, b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
