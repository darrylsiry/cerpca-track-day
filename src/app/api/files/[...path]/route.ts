import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema as s } from "@/db";
import { getSessionUser } from "@/server/auth";
import { readLocalUpload } from "@/server/storage";

/**
 * Serves uploads kept on this machine (./.data/uploads). Paths look like
 * /api/files/tech/<userId>/<file>; only that user or an administrator may open them.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in to open this file." }, { status: 401 });
  const { path } = await ctx.params;

  const ownerId = path.length >= 3 ? path[1] : null;
  if (ownerId !== user.id) {
    const db = await getDb();
    const memberships = await db.select({ isAdmin: s.memberships.isAdmin }).from(s.memberships).where(eq(s.memberships.userId, user.id));
    if (!memberships.some((m) => m.isAdmin)) return NextResponse.json({ error: "You do not have access to this file." }, { status: 403 });
  }

  const file = await readLocalUpload(path);
  if (!file) return NextResponse.json({ error: "File not found." }, { status: 404 });
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.data.length),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
