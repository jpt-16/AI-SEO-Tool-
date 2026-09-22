const OUTLINE = "M14 0H96V23H57.5V81H0V42H23V58H34.5V23H14Z";
const CUTS = "M31.18 22.08L58.42 49.32L60.82 46.92L33.58 19.68ZM31.18 57.08L58.42 84.32L60.82 81.92L33.58 54.68Z";

// The JT monogram from jtbuildsco.com/assets/logo-icon.svg.
export function Monogram({ height = 36 }: { height?: number }) {
  return (
    <svg height={height} width={(height * 96) / 81} viewBox="0 0 96 81" role="img" aria-label="JT Builds Co.">
      <mask id="jt-monogram" maskUnits="userSpaceOnUse" x="-4" y="-4" width="104" height="94">
        <path d={OUTLINE} fill="#fff" />
        <path d={CUTS} fill="#000" />
      </mask>
      <g mask="url(#jt-monogram)">
        <path d={OUTLINE} fill="currentColor" />
      </g>
    </svg>
  );
}
