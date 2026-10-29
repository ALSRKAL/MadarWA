import { BRAND_COLORS } from "./constants";

/**
 * MadarWA's mark (مدار, "orbit"): a planet whose tilted ring passes behind it
 * at the top and in front of it at the bottom, with one gold satellite riding
 * the ring. Two colours on the green tile and no gradients or glows, so it
 * holds up from the 16px toolbar icon to the 128px store icon, on light and
 * dark grounds.
 *
 * This is the only drawing of the mark. The extension icons
 * (scripts/generate-icons.mjs), the launcher in WhatsApp's header and the
 * React mark in the panel, popup and lock screen are all built from it.
 */

/** Shapes are laid out on a 24-unit square tile. */
export const BRAND_MARK_UNITS = 24;

/**
 * - `tiny`: 16px. The front of the ring merges into the planet; only the back
 *   of the ring and the satellite keep a gap, because thinner cuts smudge.
 * - `small`: up to about 40px (toolbar at 2x, launcher, headers). Heavier
 *   strokes and wider gaps so the overlap still reads.
 * - `full`: 48px and up (extensions page, store, lock screen).
 */
export type BrandMarkDetail = "tiny" | "small" | "full";

export type BrandShape =
  | { kind: "tile"; size: number; radius: number; fill: string }
  | { kind: "circle"; cx: number; cy: number; r: number; fill: string }
  | { kind: "stroke"; d: string; stroke: string; width: number; cap: "butt" | "round" };

interface Geometry {
  /** Tile corner radius. */
  radius: number;
  /** Planet centre and radius. */
  cx: number;
  cy: number;
  planet: number;
  /** Ring semi-axes, tilt in degrees (negative raises the right end) and stroke width. */
  rx: number;
  ry: number;
  tilt: number;
  ring: number;
  /** Satellite radius. It sits on the ring's raised end. */
  satellite: number;
  /** Tile-coloured cut where the back of the ring goes behind the planet. */
  planetGap: number;
  /**
   * How the front of the ring shows over the planet: `cut` outlines it on both
   * sides (the planet's lower edge shows below it); `groove` cuts only the
   * side towards the planet's centre, which stays clean at small sizes;
   * `merge` lets it run into the planet's edge with no cut; `behind` hides it.
   */
  front: "cut" | "groove" | "merge" | "behind";
  frontGap: number;
  /** Tile-coloured cut around the satellite. */
  satelliteGap: number;
}

const GEOMETRY: Record<BrandMarkDetail, Geometry> = {
  tiny: {
    radius: 5.5,
    cx: 11.4,
    cy: 12.5,
    planet: 4,
    rx: 9.4,
    ry: 3.1,
    tilt: -27,
    ring: 1.6,
    satellite: 2.4,
    planetGap: 1.2,
    front: "merge",
    frontGap: 0,
    satelliteGap: 1.1,
  },
  small: {
    radius: 5.5,
    cx: 11.4,
    cy: 12.5,
    planet: 5,
    rx: 9.5,
    ry: 2,
    tilt: -27,
    ring: 1.75,
    satellite: 2.3,
    planetGap: 0.85,
    front: "groove",
    frontGap: 0.9,
    satelliteGap: 0.9,
  },
  full: {
    radius: 5.5,
    cx: 11.4,
    cy: 12.5,
    planet: 5,
    rx: 9.5,
    ry: 2,
    tilt: -27,
    ring: 1.4,
    satellite: 2.1,
    planetGap: 0.7,
    front: "cut",
    frontGap: 0.7,
    satelliteGap: 0.75,
  },
};

const round = (value: number): number => Number(value.toFixed(3));

/**
 * The front arc moved `offset` towards the planet's centre, as a polyline,
 * kept only within `limit` of the centre (inside the planet and its cut).
 */
function innerOffset(g: Geometry, offset: number, limit: number): string {
  const angle = (g.tilt * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const points: string[] = [];
  const steps = 120;
  for (let step = 0; step <= steps; step += 1) {
    const t = (Math.PI * step) / steps;
    const nx = g.ry * Math.cos(t);
    const ny = g.rx * Math.sin(t);
    const length = Math.hypot(nx, ny);
    const x = g.rx * Math.cos(t) - (offset * nx) / length;
    const y = g.ry * Math.sin(t) - (offset * ny) / length;
    if (Math.hypot(x, y) > limit) continue;
    points.push(`${round(g.cx + x * cos - y * sin)} ${round(g.cy + x * sin + y * cos)}`);
  }
  return `M ${points.join(" L ")}`;
}

function buildShapes(detail: BrandMarkDetail): BrandShape[] {
  const g = GEOMETRY[detail];
  const tile = BRAND_COLORS.accent;
  const ink = BRAND_COLORS.onAccent;

  const angle = (g.tilt * Math.PI) / 180;
  const dx = g.rx * Math.cos(angle);
  const dy = g.rx * Math.sin(angle);
  const raised = `${round(g.cx + dx)} ${round(g.cy + dy)}`;
  const lowered = `${round(g.cx - dx)} ${round(g.cy - dy)}`;
  // Sweep 1 runs clockwise on screen: from the lowered end over the top is the
  // back of the ring, from the raised end under the planet is the front.
  const arc = (to: string) => `A ${g.rx} ${g.ry} ${g.tilt} 0 1 ${to}`;
  const wholeRing = `M ${lowered} ${arc(raised)} ${arc(lowered)} Z`;
  const frontArc = `M ${raised} ${arc(lowered)}`;

  const shapes: BrandShape[] = [
    { kind: "tile", size: BRAND_MARK_UNITS, radius: g.radius, fill: tile },
    { kind: "stroke", d: wholeRing, stroke: ink, width: g.ring, cap: "butt" },
    { kind: "circle", cx: g.cx, cy: g.cy, r: round(g.planet + g.planetGap), fill: tile },
    { kind: "circle", cx: g.cx, cy: g.cy, r: g.planet, fill: ink },
  ];
  if (g.front === "cut") {
    shapes.push({ kind: "stroke", d: frontArc, stroke: tile, width: round(g.ring + 2 * g.frontGap), cap: "butt" });
  }
  // The front arc again, over the planet's cut. A round cap hides the seam
  // where it meets the back of the ring.
  if (g.front !== "behind") shapes.push({ kind: "stroke", d: frontArc, stroke: ink, width: g.ring, cap: "round" });
  if (g.front === "groove") {
    const groove = innerOffset(g, (g.ring + g.frontGap) / 2, g.planet + g.planetGap);
    shapes.push({ kind: "stroke", d: groove, stroke: tile, width: g.frontGap, cap: "butt" });
  }
  const sx = round(g.cx + dx);
  const sy = round(g.cy + dy);
  shapes.push({ kind: "circle", cx: sx, cy: sy, r: round(g.satellite + g.satelliteGap), fill: tile });
  shapes.push({ kind: "circle", cx: sx, cy: sy, r: g.satellite, fill: BRAND_COLORS.satellite });
  return shapes;
}

const SHAPES: Record<BrandMarkDetail, readonly BrandShape[]> = {
  tiny: buildShapes("tiny"),
  small: buildShapes("small"),
  full: buildShapes("full"),
};

/** The mark's shapes, back to front, on a {@link BRAND_MARK_UNITS} tile. */
export function brandMarkShapes(detail: BrandMarkDetail): readonly BrandShape[] {
  return SHAPES[detail];
}

function shapeToSvg(shape: BrandShape): string {
  switch (shape.kind) {
    case "tile":
      return `<rect width="${shape.size}" height="${shape.size}" rx="${shape.radius}" fill="${shape.fill}"/>`;
    case "circle":
      return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${shape.fill}"/>`;
    case "stroke":
      return `<path d="${shape.d}" fill="none" stroke="${shape.stroke}" stroke-width="${shape.width}" stroke-linecap="${shape.cap}"/>`;
  }
}

export interface BrandMarkSvgOptions {
  detail?: BrandMarkDetail;
  /**
   * Pixel size of a standalone file (adds xmlns, width and height). Without it
   * the SVG is decorative markup sized by CSS.
   */
  size?: number;
  /** Transparent margin around the tile, in pixels of `size`. */
  padding?: number;
}

/** The mark as SVG markup: an icon file when `size` is given, otherwise inline markup for the UI. */
export function brandMarkSvg({ detail = "small", size, padding = 0 }: BrandMarkSvgOptions = {}): string {
  const margin = size && padding > 0 ? (padding * BRAND_MARK_UNITS) / (size - 2 * padding) : 0;
  const box = BRAND_MARK_UNITS + 2 * margin;
  const viewBox = [-margin, -margin, box, box].map(round).join(" ");
  const attributes = size
    ? `xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}"`
    : `viewBox="${viewBox}" aria-hidden="true"`;
  return `<svg ${attributes}>${SHAPES[detail].map(shapeToSvg).join("")}</svg>`;
}
