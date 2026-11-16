"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useActionState, useTransition } from "react";
import { SubmitButton } from "@/components/form";
import { Field, Notice } from "@/components/ui";
import { demoSignIn, signInStep, type LoginState } from "./actions";

const initial: LoginState = { step: "email", email: "" };

export function LoginForm() {
  const [state, action] = useActionState(signInStep, initial);

  if (state.step === "code") {
    return (
      <form action={action} className="space-y-4">
        <input type="hidden" name="email" value={state.email} />
        <p className="text-[15px] text-ink-2">
          If <strong className="text-ink">{state.email}</strong> is on a roster, a 6-digit code is on its way. It expires in 10 minutes.
        </p>
        {state.devCode ? (
          <Notice tone="warn" title="Email is not set up in this environment">
            Your code is <span className="timing text-lg font-bold">{state.devCode}</span>
          </Notice>
        ) : null}
        <Field label="Sign-in code" error={state.error}>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            autoFocus
            required
            className="ctl timing h-14 text-center text-2xl tracking-[0.3em]"
            placeholder="······"
          />
        </Field>
        <SubmitButton size="lg" className="w-full" pendingLabel="Checking…">
          Sign in
        </SubmitButton>
        <div className="flex justify-between text-sm font-semibold">
          <button name="intent" value="restart" formNoValidate className="text-ink-2 underline underline-offset-4 hover:text-ink">
            Use a different email
          </button>
          <button name="intent" value="resend" formNoValidate className="text-ink-2 underline underline-offset-4 hover:text-ink">
            Send a new code
          </button>
        </div>
      </form>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <Field label="Email" hint="Use the address you registered for the event with. We'll email you a one-time code; there is no password." error={state.error}>
        <input name="email" type="email" autoComplete="email" inputMode="email" required defaultValue={state.email} className="ctl h-13" placeholder="you@example.com" />
      </Field>
      <SubmitButton size="lg" className="w-full" pendingLabel="Sending…">
        Email me a code <ArrowRight className="size-4.5" />
      </SubmitButton>
    </form>
  );
}

export function DemoAccounts({ personas }: { personas: { email: string; label: string; detail: string }[] }) {
  const [pending, start] = useTransition();
  return (
    <div className="mt-8 border-t border-line pt-6">
      <p className="eyebrow text-ink-2">Sample accounts</p>
      <p className="mt-1.5 text-sm text-ink-2">Demo mode is on. Tap a person to see the app as they would.</p>
      <ul className="mt-3 space-y-2">
        {personas.map((p) => (
          <li key={p.email}>
            <button
              type="button"
              disabled={pending}
              onClick={() => start(() => demoSignIn(p.email))}
              className="flex w-full items-center justify-between gap-3 rounded-[12px] border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-ink disabled:opacity-60"
            >
              <span className="min-w-0">
                <span className="block font-bold">{p.label}</span>
                <span className="block text-sm text-ink-2">{p.detail}</span>
              </span>
              {pending ? <LoaderCircle className="size-4.5 shrink-0 animate-spin text-ink-3" /> : <ArrowRight className="size-4.5 shrink-0 text-ink-3" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
