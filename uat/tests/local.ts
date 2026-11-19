// What counts as "this machine", decided by parsing the address rather than by matching its text:
// http://127.0.0.1:@some.other.host starts like a local address and is not one.

/** True only for http://127.0.0.1[:port] or http://localhost[:port], with no user or password in it. */
export function isLocalUrl(value: string): boolean {
  let u: URL;
  try { u = new URL(value); } catch { return false; }
  return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.username === "" && u.password === "";
}

/** True only for a Postgres address on this machine. */
export function isLocalDb(value: string): boolean {
  let u: URL;
  try { u = new URL(value); } catch { return false; }
  return /^postgres(ql)?:$/.test(u.protocol) && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
}
