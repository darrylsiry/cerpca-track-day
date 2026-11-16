"use client";

import { Check, CircleAlert } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";

type Toast = { id: number; text: string; tone: "good" | "bad" };
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, tone: "good" | "bad" = "good") {
  const id = nextId++;
  toasts = [...toasts, { id, text, tone }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, tone === "bad" ? 6000 : 3200);
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const empty: Toast[] = [];

export function Toaster() {
  const list = useSyncExternalStore(
    subscribe,
    () => toasts,
    () => empty,
  );
  return (
    <div aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom)+12px)] z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-6">
      {list.map((t) => (
        <div
          key={t.id}
          className={cn(
            "animate-rise pointer-events-auto flex max-w-md items-center gap-2.5 rounded-full px-4 py-2.5 text-[15px] font-semibold text-white shadow-pop",
            t.tone === "good" ? "bg-ink" : "bg-bad",
          )}
        >
          {t.tone === "good" ? <Check className="size-4.5 shrink-0" strokeWidth={3} /> : <CircleAlert className="size-4.5 shrink-0" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
