import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TrackMap } from "@/components/track-map";
import { roeblingRoadGuide } from "@/content/roebling-road";
import { DEMO_PERSONAS } from "@/db/seed";
import { demoMode, getSessionUser } from "@/server/auth";
import { DemoAccounts, LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  const shape = roeblingRoadGuide.shape;
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      {/* The circuit is the cover. */}
      <section className="relative flex flex-col justify-between overflow-hidden bg-ink px-6 pt-7 pb-6 text-white sm:px-10 lg:sticky lg:top-0 lg:h-dvh lg:px-14 lg:py-12">
        <div className="relative z-10">
          <p className="eyebrow max-w-[16rem] text-white/70 sm:max-w-none">Coastal Empire Region · Porsche Club of America</p>
          <h1 className="board mt-3 text-[4.2rem] sm:text-[6rem] lg:text-[7.5rem]">
            Track
            <br />
            Day
          </h1>
        </div>
        {/* Phones: the circuit sits behind the title so the form stays above the fold. */}
        <TrackMap shape={shape} quiet trackColor="#ffffff" trackWidth={12} showTurns={false} className="pointer-events-none absolute right-[-18%] bottom-3 w-[78%] opacity-30 sm:right-[-6%] sm:w-[62%] lg:hidden" />
        <div className="mt-6 hidden lg:mt-0 lg:block">
          <TrackMap shape={shape} quiet trackColor="#ffffff" trackWidth={11} showTurns={false} className="max-w-[640px] opacity-95" />
          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div>
              <dt className="eyebrow text-white/60">Venue</dt>
              <dd className="mt-0.5 font-semibold">Roebling Road Raceway</dd>
            </div>
            <div>
              <dt className="eyebrow text-white/60">Lap</dt>
              <dd className="timing mt-0.5 font-semibold">2.02 mi · 9 turns</dd>
            </div>
            <div>
              <dt className="eyebrow text-white/60">Where</dt>
              <dd className="mt-0.5 font-semibold">Bloomingdale, Georgia</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="flex items-start justify-center px-6 py-8 sm:px-10 lg:items-center lg:py-12">
        <div className="w-full max-w-md">
          <h2 className="board text-3xl">Sign in</h2>
          <p className="mt-2 text-[15px] text-ink-2">Your schedule, your run group, your paperwork and the track guide, in one place.</p>
          <div className="mt-6">
            <LoginForm />
          </div>
          <Suspense fallback={null}>
            <SignedInRedirectAndDemo />
          </Suspense>
        </div>
      </section>
    </div>
  );
}

async function SignedInRedirectAndDemo() {
  const user = await getSessionUser();
  if (user) redirect("/home");
  if (!demoMode()) return null;
  return <DemoAccounts personas={DEMO_PERSONAS} />;
}
