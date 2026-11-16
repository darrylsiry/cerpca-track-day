"use client";

import { CircleDot, Eraser, PenLine, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { TrackShape } from "@/lib/types";
import { TrackMap } from "./track-map";

type Point = [number, number];
type Mark = { kind: "pen"; points: Point[] } | { kind: "car"; at: Point; n: number };

const DEFAULT_BOX: [number, number, number, number] = [0, 0, 1000, 486];
/** Bitmap pixels per drawing unit. The saved PNG is the same size on every device. */
const SCALE = 1.5;
const PEN = "#d1242a";
const CAR = "#1d5fd1";
const TRACK = "#c3c9cf";

function drawMarks(ctx: CanvasRenderingContext2D, marks: Mark[]) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const mark of marks) {
    if (mark.kind === "pen") {
      ctx.strokeStyle = PEN;
      ctx.fillStyle = PEN;
      ctx.lineWidth = 7;
      if (mark.points.length === 1) {
        ctx.beginPath();
        ctx.arc(mark.points[0][0], mark.points[0][1], 4, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(mark.points[0][0], mark.points[0][1]);
      for (let i = 1; i < mark.points.length; i++) ctx.lineTo(mark.points[i][0], mark.points[i][1]);
      ctx.stroke();
    } else {
      const [x, y] = mark.at;
      ctx.beginPath();
      ctx.arc(x, y, 17, 0, Math.PI * 2);
      ctx.fillStyle = CAR;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 20px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(mark.n), x, y + 1);
    }
  }
}

function drawTrack(ctx: CanvasRenderingContext2D, shape: TrackShape) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = TRACK;
  if (shape.pitLane) {
    ctx.lineWidth = 7;
    ctx.stroke(new Path2D(shape.pitLane));
  }
  ctx.lineWidth = 13;
  ctx.stroke(new Path2D(shape.d));
  ctx.font = "bold 22px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const turn of shape.turns) {
    const [x, y] = turn.label;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#8d959d";
    ctx.stroke();
    ctx.fillStyle = "#6b727a";
    ctx.fillText(String(turn.n), x, y + 1);
  }
}

/**
 * Freehand incident sketch over a faint drawing of the circuit: a pen for
 * paths, numbered markers for car positions, undo and clear.
 *
 * The result travels with the surrounding form in a hidden input named `name`:
 *   ""       nothing changed (keep whatever is stored)
 *   "clear"  the stored sketch was removed
 *   data URL the new sketch, as a PNG that includes the circuit backdrop
 * When `existing` is given, that image becomes the backdrop and new marks are
 * drawn on top of it.
 */
export function SketchPad({
  name,
  shape,
  existing,
  className,
}: {
  name: string;
  shape: TrackShape | null;
  existing?: string | null;
  className?: string;
}) {
  const box = shape?.viewBox ?? DEFAULT_BOX;
  const [, , W, H] = box;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseImage = useRef<HTMLImageElement | null>(null);
  const live = useRef<Point[] | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [tool, setTool] = useState<"pen" | "car">("pen");
  const [base, setBase] = useState<string | null>(existing ?? null);
  const [loadedBase, setLoadedBase] = useState<string | null>(null);

  // Keep a decoded copy of the stored sketch for compositing the export.
  useEffect(() => {
    if (!base) {
      baseImage.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      baseImage.current = img;
      setLoadedBase(base);
    };
    img.src = base;
  }, [base]);

  // Repaint the visible layer and refresh the value that will be submitted.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    drawMarks(ctx, marks);

    const input = inputRef.current;
    if (!input) return;
    if (!marks.length) {
      input.value = existing && !base ? "clear" : "";
      return;
    }
    // The stored sketch is still decoding: wait for it rather than export without it.
    if (base && loadedBase !== base) return;
    const out = document.createElement("canvas");
    out.width = Math.round(W * SCALE);
    out.height = Math.round(H * SCALE);
    const octx = out.getContext("2d");
    if (!octx) return;
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, out.width, out.height);
    if (base && baseImage.current) {
      octx.drawImage(baseImage.current, 0, 0, out.width, out.height);
    } else if (shape) {
      octx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      drawTrack(octx, shape);
    }
    octx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    drawMarks(octx, marks);
    input.value = out.toDataURL("image/png");
  }, [marks, base, loadedBase, existing, shape, W, H]);

  const toPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [Math.round(((e.clientX - rect.left) / rect.width) * W * 10) / 10, Math.round(((e.clientY - rect.top) / rect.height) * H * 10) / 10];
  };

  const finishStroke = () => {
    const points = live.current;
    live.current = null;
    if (points?.length) setMarks((list) => [...list, { kind: "pen", points }]);
  };

  const carCount = marks.filter((m) => m.kind === "car").length;
  const untouched = !marks.length && (!existing || base === existing);

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Drawing tool" className="inline-flex gap-1 rounded-[12px] border border-line bg-surface p-1">
          {(
            [
              { key: "pen", label: "Pen", icon: PenLine },
              { key: "car", label: "Car position", icon: CircleDot },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={tool === t.key}
              onClick={() => setTool(t.key)}
              className={cn(
                "flex h-10 items-center gap-1.5 rounded-[9px] px-3 text-sm font-semibold transition-colors",
                tool === t.key ? "bg-ink text-white" : "text-ink-2 hover:bg-sunk hover:text-ink",
              )}
            >
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => setMarks((list) => list.slice(0, -1))}
            disabled={!marks.length}
            className="inline-flex h-10 items-center gap-1.5 rounded-[10px] px-3 text-sm font-semibold text-ink-2 hover:bg-sunk disabled:opacity-40"
          >
            <Undo2 className="size-4" /> Undo
          </button>
          <button
            type="button"
            onClick={() => {
              setMarks([]);
              setBase(null);
            }}
            disabled={!marks.length && !base}
            className="inline-flex h-10 items-center gap-1.5 rounded-[10px] px-3 text-sm font-semibold text-ink-2 hover:bg-sunk disabled:opacity-40"
          >
            <Eraser className="size-4" /> Clear
          </button>
        </div>
      </div>

      <div className="relative w-full overflow-hidden rounded-[10px] border border-line-strong bg-white" style={{ aspectRatio: `${W} / ${H}` }}>
        {base ? (
          // eslint-disable-next-line @next/next/no-img-element -- stored data URL
          <img src={base} alt="" className="pointer-events-none absolute inset-0 size-full object-fill" />
        ) : shape ? (
          <TrackMap shape={shape} quiet trackColor={TRACK} className="pointer-events-none absolute inset-0" />
        ) : null}
        <canvas
          ref={canvasRef}
          width={Math.round(W * SCALE)}
          height={Math.round(H * SCALE)}
          role="img"
          aria-label="Sketch of the incident"
          className={cn("absolute inset-0 size-full touch-none", tool === "pen" ? "cursor-crosshair" : "cursor-copy")}
          onPointerDown={(e) => {
            const p = toPoint(e);
            if (tool === "car") {
              setMarks((list) => [...list, { kind: "car", at: p, n: list.filter((m) => m.kind === "car").length + 1 }]);
              return;
            }
            e.currentTarget.setPointerCapture(e.pointerId);
            live.current = [p];
          }}
          onPointerMove={(e) => {
            const points = live.current;
            if (!points) return;
            const p = toPoint(e);
            const prev = points[points.length - 1];
            if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 2) return;
            points.push(p);
            // Draw the new segment straight away; the full repaint happens when the stroke ends.
            const ctx = e.currentTarget.getContext("2d");
            if (!ctx) return;
            ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.strokeStyle = PEN;
            ctx.lineWidth = 7;
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(p[0], p[1]);
            ctx.stroke();
          }}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
        />
        {untouched && !existing ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[13px] text-ink-3">Draw the path of the car, then mark where it stopped</p>
        ) : null}
      </div>
      <p className="mt-1.5 text-[13px] text-ink-2">
        {tool === "pen" ? "Pen: drag to draw the line the car took." : `Car position: tap to drop marker ${carCount + 1}. Number them in the order things happened.`}
      </p>
      <input ref={inputRef} type="hidden" name={name} defaultValue="" />
    </div>
  );
}
