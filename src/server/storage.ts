import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/*
 * File uploads (photos or PDFs of paper tech forms).
 *
 *  BLOB_READ_WRITE_TOKEN set   → Vercel Blob. The stored reference is the blob's
 *                                 URL, which is long and unguessable.
 *  BLOB_READ_WRITE_TOKEN unset → ./.data/uploads on this machine. The stored
 *                                 reference is /api/files/<prefix>/<name>, which
 *                                 only the owner or an administrator can open.
 */

export const UPLOAD_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

const CONTENT_TYPES: Record<string, string> = Object.fromEntries(Object.entries(UPLOAD_TYPES).map(([type, ext]) => [ext, type]));

// Local uploads are a development convenience; the ignore comments keep the bundler from tracing the whole project for them.
const localRoot = () => path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "uploads");
const safeSegment = (v: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v) && !v.includes("..");

/** Store an upload and return the reference to save on the record. */
export async function saveUpload(file: File, prefix: string): Promise<string> {
  const ext = UPLOAD_TYPES[file.type];
  if (!ext) throw new Error("Upload a photo (JPEG, PNG, WebP or HEIC) or a PDF.");
  const segments = prefix.split("/").filter(Boolean);
  if (!segments.length || !segments.every(safeSegment)) throw new Error("That upload location is not allowed.");
  const name = `${randomUUID()}.${ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blob = await put(`${segments.join("/")}/${name}`, file, { access: "public", contentType: file.type, token: process.env.BLOB_READ_WRITE_TOKEN });
    return blob.url;
  }

  const dir = path.join(/* turbopackIgnore: true */ localRoot(), ...segments);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(/* turbopackIgnore: true */ dir, name), Buffer.from(await file.arrayBuffer()));
  return `/api/files/${segments.join("/")}/${name}`;
}

/** Read a locally stored upload. Returns null for anything that is not a plain file under the uploads folder. */
export async function readLocalUpload(segments: string[]): Promise<{ data: Buffer; contentType: string } | null> {
  if (!segments.length || !segments.every(safeSegment)) return null;
  const root = localRoot();
  const full = path.resolve(/* turbopackIgnore: true */ root, ...segments);
  if (!full.startsWith(root + path.sep)) return null;
  const ext = path.extname(full).slice(1).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) return null;
  try {
    return { data: await readFile(full), contentType };
  } catch {
    return null;
  }
}

export const isPdf = (ref: string | null | undefined) => Boolean(ref && /\.pdf(\?|$)/i.test(ref));
/** Browsers can't show HEIC inline; offer it as a download instead. */
export const isInlineImage = (ref: string | null | undefined) => Boolean(ref && /\.(jpe?g|png|webp)(\?|$)/i.test(ref));
