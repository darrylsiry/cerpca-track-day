import { LogOut } from "lucide-react";
import type { Metadata } from "next";
import { signOut } from "@/app/login/actions";
import { MoreMenu } from "@/components/shell/nav";
import { Avatar, CarNumber, GroupChip } from "@/components/ui";
import { fullName } from "@/lib/cn";
import { getViewer } from "@/server/auth";
import { adminBadges, unreadCount } from "@/server/queries";
import { shellProps } from "@/components/shell/props";
import { screen } from "@/components/shell/skeleton";

export const metadata: Metadata = { title: "More" };

export default screen(async function MorePage() {
  const v = await getViewer();
  const [unread, badges] = await Promise.all([
    unreadCount(v.user.id),
    v.isAdmin
      ? adminBadges(v.org.id, v.event?.id ?? null)
      : Promise.resolve({ tech: 0, promotions: 0, incidents: 0 }),
  ]);
  const props = shellProps(v, unread, badges);
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="sr-only">More</h1>
      <div className="mb-6 flex items-center gap-3.5 rounded-[14px] border border-line bg-surface px-4 py-4">
        <Avatar name={fullName(v.user)} className="size-12 text-base" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg leading-tight font-bold">
            {fullName(v.user)}
          </p>
          <p className="truncate text-sm text-ink-2">{props.roleLine}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <GroupChip group={v.group} />
          <CarNumber n={v.registration?.carNumber} size="sm" />
        </div>
      </div>
      <MoreMenu {...props} />
      <form action={signOut} className="mt-8">
        <button className="flex h-12 w-full items-center justify-center gap-2 rounded-[12px] border border-line-strong bg-surface text-[15px] font-semibold hover:bg-sunk">
          <LogOut className="size-4" /> Sign out
        </button>
      </form>
    </div>
  );
});
