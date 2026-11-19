"use client";

import { Eraser } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Draw-to-sign box for touch, pen and mouse. The signature is submitted with
 * the surrounding form as a PNG data URL in a hidden input named `name`
 * (empty string when nothing has been drawn; validate that on the server).
 */
export function SignaturePad({
  name,
  label = "Sign here",
  className,
  onChange,
}: {
  name: string;
  label?: string;
  className?: string;
  onChange?: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);
  // Held in state and rendered into the hidden input. Writing to the input
  // directly is lost on the next render: React puts the default value back.
  const [dataUrl, setDataUrl] = useState("");

  // Size the bitmap to the box once, at device resolution, so strokes stay crisp.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = "#14171a";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const commit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    setDataUrl(url);
    onChange?.(url);
  }, [onChange]);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setDataUrl("");
    setEmpty(true);
    onChange?.("");
  };

  return (
    <div className={className}>
      <div className="relative">
        <canvas
          ref={canvasRef}
          aria-label={label}
          role="img"
          className={cn("block h-40 w-full touch-none rounded-[10px] border bg-white", empty ? "border-dashed border-line-strong" : "border-ink")}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            last.current = point(e);
            const ctx = e.currentTarget.getContext("2d");
            if (ctx && last.current) {
              // a tap leaves a dot
              ctx.beginPath();
              ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
              ctx.fillStyle = "#14171a";
              ctx.fill();
            }
            setEmpty(false);
          }}
          onPointerMove={(e) => {
            if (!drawing.current || !last.current) return;
            const ctx = e.currentTarget.getContext("2d");
            if (!ctx) return;
            const p = point(e);
            const mid = { x: (last.current.x + p.x) / 2, y: (last.current.y + p.y) / 2 };
            ctx.beginPath();
            ctx.moveTo(last.current.x, last.current.y);
            ctx.quadraticCurveTo(last.current.x, last.current.y, mid.x, mid.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            last.current = p;
          }}
          onPointerUp={() => {
            if (!drawing.current) return;
            drawing.current = false;
            last.current = null;
            commit();
          }}
          onPointerCancel={() => {
            drawing.current = false;
            last.current = null;
          }}
        />
        {empty ? (
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-[15px] text-ink-3">{label}: draw with your finger or mouse</p>
        ) : null}
        <span className="pointer-events-none absolute inset-x-5 bottom-8 border-b border-line-strong" aria-hidden />
      </div>
      <div className="mt-1.5 flex justify-end">
        <button type="button" onClick={clear} disabled={empty} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-ink-2 hover:bg-sunk disabled:opacity-40">
          <Eraser className="size-3.5" /> Clear
        </button>
      </div>
      <input type="hidden" name={name} value={dataUrl} readOnly />
    </div>
  );
}

/** Read-only rendering of a stored signature. */
export function SignatureImage({ src, alt, className }: { src?: string | null; alt: string; className?: string }) {
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element -- data URLs; nothing for the image optimizer to do
  return <img src={src} alt={alt} className={cn("h-16 w-auto max-w-full rounded-md border border-line bg-white object-contain px-2", className)} />;
}
