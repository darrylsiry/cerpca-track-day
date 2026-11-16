"use client";

import { Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * An image that opens full screen when tapped. In the viewer it can be
 * enlarged and panned, and the browser's own pinch-zoom still works, which is
 * what people reach for on a phone when reading a map.
 */
export function ZoomImage({
  src,
  alt,
  width,
  height,
  caption,
  className,
  sizes = "(min-width: 1024px) 720px, 100vw",
  priority,
}: {
  src: string;
  alt: string;
  /** Intrinsic size (or a close aspect-ratio hint) so the page doesn't jump while it loads. */
  width: number;
  height: number;
  caption?: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (open && el && !el.open) el.showModal();
  }, [open]);

  return (
    <figure className={className}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Enlarge: ${alt}`}
        className="group relative block w-full overflow-hidden rounded-[12px] border border-line bg-white"
      >
        <Image src={src} alt={alt} width={width} height={height} sizes={sizes} priority={priority} className="h-auto w-full" />
        <span className="absolute right-2 bottom-2 inline-flex h-9 items-center gap-1.5 rounded-full bg-ink/85 px-3 text-[13px] font-semibold text-white">
          <Maximize2 className="size-3.5" aria-hidden /> Enlarge
        </span>
      </button>
      {caption ? <figcaption className="mt-1.5 text-[13px] text-ink-2">{caption}</figcaption> : null}

      {open ? (
        <dialog
          ref={ref}
          onClose={() => {
            setOpen(false);
            setZoomed(false);
          }}
          className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none flex-col bg-ink p-0 text-white backdrop:bg-ink open:flex"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
            <p className="min-w-0 truncate pl-1 text-[15px] font-semibold">{alt}</p>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setZoomed((z) => !z)}
                className="inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold hover:bg-white/15"
              >
                {zoomed ? <ZoomOut className="size-4.5" aria-hidden /> : <ZoomIn className="size-4.5" aria-hidden />}
                {zoomed ? "Fit" : "Zoom"}
              </button>
              <a href={src} target="_blank" rel="noreferrer" className="hidden h-11 items-center rounded-full px-3.5 text-sm font-semibold hover:bg-white/15 sm:inline-flex">
                Open original
              </a>
              <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="grid size-11 place-items-center rounded-full hover:bg-white/15">
                <X className="size-5.5" />
              </button>
            </div>
          </div>
          <div className={cn("min-h-0 flex-1 overflow-auto overscroll-contain", !zoomed && "grid place-items-center")} onClick={(e) => e.target === e.currentTarget && ref.current?.close()}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the viewer shows the original file at full resolution */}
            <img
              src={src}
              alt={alt}
              onDoubleClick={() => setZoomed((z) => !z)}
              className={cn("bg-white", zoomed ? "h-auto w-[240vw] max-w-none sm:w-[170vw]" : "max-h-full max-w-full object-contain")}
            />
          </div>
        </dialog>
      ) : null}
    </figure>
  );
}
