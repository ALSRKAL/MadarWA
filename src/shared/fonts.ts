/**
 * The UI typeface: IBM Plex Sans Arabic (OFL-1.1), bundled with the
 * extension so nothing is fetched from a font CDN. One family covers Arabic
 * and Latin; weights 400/500/600 only.
 *
 * Chrome ignores @font-face inside a shadow root, so the content script
 * declares these faces on the page document under a private family name;
 * the panel's shadow styles then reference that name.
 */
export const UI_FONT_FAMILY = "MadarWA Plex";

const RANGES = {
  arabic:
    "U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC",
  latin:
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
} as const;

const WEIGHTS = [400, 500, 600] as const;

/** Font files copied into `dist/fonts/` by the build. */
export const UI_FONT_FILES = WEIGHTS.flatMap((weight) =>
  (Object.keys(RANGES) as Array<keyof typeof RANGES>).map((subset) => ({
    weight,
    subset,
    file: `ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`,
  })),
);

export function uiFontFaceCss(urlFor: (file: string) => string): string {
  return UI_FONT_FILES.map(
    ({ weight, subset, file }) =>
      `@font-face{font-family:"${UI_FONT_FAMILY}";font-style:normal;font-weight:${weight};font-display:swap;` +
      `src:url("${urlFor(`fonts/${file}`)}") format("woff2");unicode-range:${RANGES[subset]};}`,
  ).join("\n");
}

/** Adds the faces to a document once; safe to call repeatedly. */
export function installUiFonts(doc: Document, urlFor: (file: string) => string): void {
  const id = "madarwa-ui-fonts";
  if (doc.getElementById(id)) return;
  const style = doc.createElement("style");
  style.id = id;
  style.textContent = uiFontFaceCss(urlFor);
  (doc.head ?? doc.documentElement).appendChild(style);
}
