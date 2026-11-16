import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { TrackShape } from "@/lib/types";

/** A stretch of the lap, as fractions of lap distance from start/finish. May wrap past 1. */
export type Segment = { start: number; end: number; color?: string; width?: number; key?: string | number };

function dash(seg: Segment) {
  const len = (((seg.end - seg.start) % 1) + 1) % 1 || 1;
  return { strokeDasharray: `${len} ${1 - len}`, strokeDashoffset: 1 - seg.start };
}

/**
 * The circuit, drawn from the track's stored centerline. Everything laid on top
 * (turn highlights, passing zones) is positioned by lap fraction, so a new track
 * only needs its own shape data.
 */
export function TrackMap({
  shape,
  segments = [],
  activeTurn,
  showTurns = true,
  turnHref,
  onTurnClick,
  className,
  trackColor = "var(--color-ink)",
  trackWidth = 13,
  label,
  children,
  quiet,
}: {
  shape: TrackShape;
  segments?: Segment[];
  activeTurn?: number | null;
  showTurns?: boolean;
  turnHref?: (n: number) => string;
  onTurnClick?: (n: number) => void;
  className?: string;
  trackColor?: string;
  trackWidth?: number;
  label?: string;
  children?: ReactNode;
  /** Decorative use: no labels, no semantics. */
  quiet?: boolean;
}) {
  const [x, y, w, h] = shape.viewBox;
  const [sx, sy] = shape.startFinish;
  return (
    <svg
      viewBox={`${x} ${y} ${w} ${h}`}
      className={cn("block h-auto w-full", className)}
      role={quiet ? "presentation" : "img"}
      aria-label={quiet ? undefined : (label ?? "Track map")}
      aria-hidden={quiet || undefined}
    >
      {shape.pitLane ? <path d={shape.pitLane} fill="none" stroke={trackColor} strokeOpacity={0.28} strokeWidth={trackWidth * 0.55} strokeLinecap="round" strokeLinejoin="round" /> : null}
      <path d={shape.d} fill="none" stroke={trackColor} strokeWidth={trackWidth} strokeLinejoin="round" />
      {segments.map((seg, i) => (
        <path
          key={seg.key ?? i}
          d={shape.d}
          pathLength={1}
          fill="none"
          stroke={seg.color ?? "var(--color-flag-red)"}
          strokeWidth={seg.width ?? trackWidth}
          strokeLinejoin="round"
          {...dash(seg)}
        />
      ))}
      {/* start/finish */}
      <g transform={`translate(${sx} ${sy})`}>
        <rect x={-3} y={-trackWidth / 2 - 5} width={6} height={trackWidth + 10} fill="#fff" stroke={trackColor} strokeWidth={1.5} />
        <rect x={-3} y={-trackWidth / 2 - 5} width={3} height={(trackWidth + 10) / 2} fill={trackColor} />
        <rect x={0} y={-trackWidth / 2 - 5 + (trackWidth + 10) / 2} width={3} height={(trackWidth + 10) / 2} fill={trackColor} />
      </g>
      {showTurns
        ? shape.turns.map((t) => {
            const active = activeTurn === t.n;
            const [lx, ly] = t.label;
            const marker = (
              <g className={cn(turnHref || onTurnClick ? "cursor-pointer" : undefined)}>
                {/* generous invisible hit area for thumbs */}
                <circle cx={lx} cy={ly} r={34} fill="transparent" />
                <circle cx={lx} cy={ly} r={active ? 23 : 19} fill={active ? "var(--color-flag-red)" : "#fff"} stroke={active ? "var(--color-flag-red)" : trackColor} strokeWidth={2.5} />
                <text
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontFamily="var(--font-display)"
                  fontWeight={800}
                  fontSize={active ? 27 : 23}
                  fill={active ? "#fff" : trackColor}
                >
                  {t.n}
                </text>
              </g>
            );
            if (turnHref) {
              return (
                <a key={t.n} href={turnHref(t.n)} aria-label={`Turn ${t.n}`} aria-current={active ? "true" : undefined}>
                  {marker}
                </a>
              );
            }
            if (onTurnClick) {
              return (
                <g
                  key={t.n}
                  role="button"
                  tabIndex={0}
                  aria-label={`Turn ${t.n}`}
                  aria-pressed={active}
                  onClick={() => onTurnClick(t.n)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onTurnClick(t.n);
                    }
                  }}
                >
                  {marker}
                </g>
              );
            }
            return <g key={t.n}>{marker}</g>;
          })
        : null}
      {children}
    </svg>
  );
}
