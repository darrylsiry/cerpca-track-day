"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema as s } from "@/db";
import { createSession, demoMode, destroySession, issueSignInCode, verifySignInCode } from "@/server/auth";

export type LoginState = { step: "email" | "code"; email: string; devCode?: string; error?: string };

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export async function signInStep(prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? prev.email ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  const intent = String(formData.get("intent") ?? "");

  if (intent === "restart") return { step: "email", email: "" };

  if (prev.step === "email" || intent === "resend") {
    if (!emailOk(email)) return { step: "email", email, error: "Enter the email address you registered with." };
    const { devCode } = await issueSignInCode(email);
    return { step: "code", email, devCode };
  }

  if (code.length !== 6) return { ...prev, error: "Enter the 6-digit code from the email." };
  const user = await verifySignInCode(email, code);
  if (!user) return { ...prev, error: "That code is wrong or has expired. Check it, or send a new one." };
  await createSession(user.id);
  redirect("/home");
}

export async function demoSignIn(email: string) {
  if (!demoMode()) throw new Error("Demo sign-in is turned off.");
  const db = await getDb();
  const [user] = await db.select().from(s.users).where(eq(s.users.email, email)).limit(1);
  if (!user) throw new Error("That sample account does not exist. Reset the demo data and try again.");
  await createSession(user.id);
  redirect("/home");
}

export async function signOut() {
  await destroySession();
  redirect("/login");
}
