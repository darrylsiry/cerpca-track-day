import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Shop inspection",
  robots: { index: false, follow: false },
};

/** The shop's page stands alone: no sign-in, no app navigation. */
export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="bg-ink text-white">
        <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
          <p className="eyebrow text-white/70">Driver education · Track Day</p>
          <p className="board mt-1.5 text-[1.9rem]">Technical inspection</p>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pt-5 pb-16 sm:px-6">{children}</main>
    </div>
  );
}
