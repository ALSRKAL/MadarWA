import { BRAND_MARK_UNITS, brandMarkShapes, type BrandMarkDetail } from "../../shared/brand";

const VIEW_BOX = `0 0 ${BRAND_MARK_UNITS} ${BRAND_MARK_UNITS}`;

/**
 * MadarWA's mark (src/shared/brand.ts) for the panel, popup, lock screen and
 * floating launcher. `small` up to about 40px, `full` above.
 */
export function BrandMark({ className, detail = "small" }: { className?: string; detail?: BrandMarkDetail }) {
  return (
    <svg viewBox={VIEW_BOX} className={className} aria-hidden="true">
      {brandMarkShapes(detail).map((shape, index) => {
        switch (shape.kind) {
          case "tile":
            return <rect key={index} width={shape.size} height={shape.size} rx={shape.radius} fill={shape.fill} />;
          case "circle":
            return <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill} />;
          case "stroke":
            return (
              <path
                key={index}
                d={shape.d}
                fill="none"
                stroke={shape.stroke}
                strokeWidth={shape.width}
                strokeLinecap={shape.cap}
              />
            );
        }
      })}
    </svg>
  );
}
