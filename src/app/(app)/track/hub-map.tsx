"use client";

import { useRouter } from "next/navigation";
import { TrackMap } from "@/components/track-map";
import type { TrackShape } from "@/lib/types";

/** The circuit on the guide's front page: tap a turn number to open that turn. */
export function HubMap({ shape, label }: { shape: TrackShape; label: string }) {
  const router = useRouter();
  return <TrackMap shape={shape} label={label} onTurnClick={(n) => router.push(`/track/turns?turn=${n}`)} />;
}
