import { cn } from "@/lib/cn";
import type { TrackFlag } from "@/lib/types";

/**
 * A marshal's flag drawn from the track guide's data (`design` + `colors`),
 * so a venue with different flags only needs different data.
 * The caller sets the width (for example `w-24`); height follows the 3:2 shape.
 */
export function FlagIcon({ flag, className }: { flag: Pick<TrackFlag, "design" | "colors" | "name">; className?: string }) {
  const [a, b = "#ffffff"] = flag.colors;
  const W = 60;
  const H = 40;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("block h-auto shrink-0 rounded-[5px]", className)} role="img" aria-label={`${flag.name} flag`}>
      <rect width={W} height={H} fill={a} />
      {flag.design === "diagonal" ? <polygon points={`0,${H} 0,${H - 9} ${W - 12},0 ${W},0 ${W},9 12,${H}`} fill={b} /> : null}
      {flag.design === "stripes"
        ? Array.from({ length: 6 }, (_, i) => <rect key={i} x={(W / 13) * (i * 2 + 1)} y={0} width={W / 13} height={H} fill={b} />)
        : null}
      {flag.design === "circle" ? <circle cx={W / 2} cy={H / 2} r={11} fill={b} /> : null}
      {flag.design === "checkered"
        ? Array.from({ length: 24 }, (_, i) => {
            const col = i % 6;
            const row = Math.floor(i / 6);
            return (col + row) % 2 === 1 ? <rect key={i} x={col * 10} y={row * 10} width={10} height={10} fill={b} /> : null;
          })
        : null}
      {/* A dark keyline so white and yellow flags hold their edge on a white card. */}
      <rect x={0.75} y={0.75} width={W - 1.5} height={H - 1.5} rx={4.25} fill="none" stroke="#14171a" strokeOpacity={0.45} strokeWidth={1.5} />
    </svg>
  );
}
