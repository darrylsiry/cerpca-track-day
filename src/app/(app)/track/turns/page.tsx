import type { Metadata } from "next";
import { screen } from "@/components/shell/skeleton";
import { PageHeader } from "@/components/ui";
import { getViewer } from "@/server/auth";
import { NoTrack, TrackTabs } from "../shared";
import { TurnExplorer } from "./turn-explorer";

export const metadata: Metadata = { title: "Turn by turn" };

export default screen(async function TurnsPage({ searchParams }: { searchParams: Promise<{ turn?: string }> }) {
  const v = await getViewer();
  const { turn } = await searchParams;
  const track = v.track;
  if (!track) return <NoTrack />;
  const g = track.guide;
  const wanted = Number(turn);
  // 0 is the "track entry" card; otherwise open on the requested turn, or the first.
  const initial = turn === "entry" ? 0 : g.turns.some((t) => t.n === wanted) ? wanted : (g.turns[0]?.n ?? 0);

  return (
    <>
      <PageHeader title="Turn by turn" lede={`${track.name}, one corner at a time. Pick a turn on the map or from the numbers below it.`} />
      <TrackTabs current="turns" />
      <TurnExplorer shape={g.shape} turns={g.turns} lineIntro={g.lineIntro} lineSource={g.lineSource} trackEntry={g.trackEntry} initial={initial} trackName={track.name} />
    </>
  );
});
