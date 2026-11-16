import { EmptyState, Segmented } from "@/components/ui";

export type TrackTab = "overview" | "turns" | "passing" | "flags" | "rules" | "maps" | "docs";

const TABS: { key: TrackTab; href: string; label: string }[] = [
  { key: "overview", href: "/track", label: "Overview" },
  { key: "turns", href: "/track/turns", label: "Turn by turn" },
  { key: "passing", href: "/track/passing", label: "Passing zones" },
  { key: "flags", href: "/track/flags", label: "Flags" },
  { key: "rules", href: "/track/rules", label: "Rules" },
  { key: "maps", href: "/track/maps", label: "Maps" },
  { key: "docs", href: "/track/docs", label: "Documents" },
];

/** Section switcher shown at the top of every track guide screen. */
export function TrackTabs({ current }: { current: TrackTab }) {
  return <Segmented label="Track guide sections" items={TABS} current={current} className="mb-5" />;
}

export function NoTrack() {
  return <EmptyState title="No track guide yet">The guide appears here once an event at a track is scheduled.</EmptyState>;
}

/** The PDF in the track's document list that matches a topic, if the track supplied one. */
export function findDocument<T extends { title: string; href: string }>(documents: T[], pattern: RegExp): T | undefined {
  return documents.find((d) => pattern.test(d.title));
}
