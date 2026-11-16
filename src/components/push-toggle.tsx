"use client";

import { BellRing, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { toast } from "./toast";
import { buttonClass } from "./ui";

type State =
  | "checking"
  | "unconfigured" // the server has no push keys
  | "unsupported" // this browser can't do web push
  | "needs-install" // iPhone/iPad: only works from the Home Screen
  | "denied" // the person blocked notifications for this site
  | "off"
  | "on";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function keyBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function detect(): Promise<State> {
  if (!VAPID) return "unconfigured";
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.register("/sw.js");
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

const COPY: Record<Exclude<State, "checking">, { status: string; help: string }> = {
  on: { status: "On for this device", help: "Session reminders and announcements will reach this device even when the app is closed." },
  off: { status: "Off for this device", help: "Turn on to get your grid reminders and announcements on this device, even when the app is closed." },
  denied: {
    status: "Blocked in this browser",
    help: "Notifications for this site are blocked. Allow them in your browser's site settings, then come back and turn them on.",
  },
  "needs-install": {
    status: "Add to Home Screen first",
    help: "On iPhone and iPad, notifications only work from the Home Screen. In Safari tap Share, then Add to Home Screen, open Track Day from there and turn notifications on.",
  },
  unsupported: { status: "Not available in this browser", help: "This browser cannot receive push notifications. Alerts still appear in the app, and you can use email or text instead." },
  unconfigured: { status: "Not set up on this server", help: "Push notifications have not been configured yet. Alerts still appear in the app." },
};

/**
 * Turns web push on or off for the device in hand. A subscription belongs to
 * one browser on one device, so this sits beside (not inside) the per-person
 * notification preferences.
 */
export function PushToggle({ className, flat }: { className?: string; flat?: boolean }) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    detect()
      .then((s) => live && setState(s))
      .catch(() => live && setState("unsupported"));
    return () => {
      live = false;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID) }));
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error("The server did not accept the subscription.");
      setState("on");
      toast("Notifications are on for this device");
    } catch {
      toast("Could not turn notifications on. Try again.", "bad");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState("off");
      toast("Notifications are off for this device");
    } catch {
      toast("Could not turn notifications off. Try again.", "bad");
    } finally {
      setBusy(false);
    }
  }

  const copy = state === "checking" ? null : COPY[state];
  const actionable = state === "on" || state === "off";

  return (
    <div className={cn(!flat && "rounded-[14px] border border-line bg-surface px-4 py-4 sm:px-5", className)}>
      <div className="flex items-start gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", state === "on" ? "bg-good-soft text-good" : "bg-sunk text-ink-2")}>
          <BellRing className="size-5" strokeWidth={2.2} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">Notifications on this device</p>
          <p className={cn("text-sm font-semibold", state === "on" ? "text-good" : state === "denied" ? "text-bad" : "text-ink-2")} aria-live="polite">
            {copy ? copy.status : "Checking this device…"}
          </p>
          {copy ? <p className="mt-1.5 text-sm text-ink-2">{copy.help}</p> : null}
        </div>
      </div>
      {actionable ? (
        <button type="button" disabled={busy} onClick={state === "on" ? turnOff : turnOn} className={buttonClass(state === "on" ? "secondary" : "primary", "md", "mt-3.5 w-full sm:w-auto")}>
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          {state === "on" ? "Turn off on this device" : "Turn on notifications"}
        </button>
      ) : null}
    </div>
  );
}
