"use client";

import { X } from "lucide-react";
import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { buttonClass } from "./ui";

const SheetContext = createContext<{ close: () => void } | null>(null);

/** Inside a Sheet, returns a function that closes it (a no-op elsewhere). */
export function useSheetClose() {
  return use(SheetContext)?.close ?? (() => {});
}

/**
 * A modal that is a centred dialog on desktop and a bottom sheet on phones.
 * Built on <dialog>, so focus trapping, Escape and the backdrop come from the browser.
 */
export function Sheet({
  trigger,
  triggerClassName,
  triggerLabel,
  title,
  description,
  children,
  wide,
  defaultOpen = false,
  onClose,
}: {
  trigger?: ReactNode;
  triggerClassName?: string;
  triggerLabel?: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  defaultOpen?: boolean;
  onClose?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const el = ref.current;
    if (open && el && !el.open) el.showModal();
  }, [open]);

  const close = useCallback(() => ref.current?.close(), []);

  return (
    <SheetContext value={{ close }}>
      {trigger !== undefined ? (
        <button type="button" aria-label={triggerLabel} className={triggerClassName ?? buttonClass("secondary", "md")} onClick={() => setOpen(true)}>
          {trigger}
        </button>
      ) : null}
      {open ? (
        <dialog
          ref={ref}
          className={cn("sheet", wide && "wide")}
          onClose={() => {
            setOpen(false);
            onClose?.();
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 pt-4 pb-3.5">
            <div className="min-w-0">
              <h2 className="board text-2xl">{title}</h2>
              {description ? <p className="mt-1.5 text-sm text-ink-2">{description}</p> : null}
            </div>
            <button type="button" onClick={close} aria-label="Close" className="-mr-2 grid size-10 shrink-0 place-items-center rounded-full hover:bg-sunk">
              <X className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">{children}</div>
        </dialog>
      ) : null}
    </SheetContext>
  );
}
