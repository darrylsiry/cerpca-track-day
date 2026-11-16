import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { GroupLite } from "@/lib/types";

/* ───────────── Buttons ───────────── */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "group";
type Size = "sm" | "md" | "lg";

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-[10px] font-semibold whitespace-nowrap transition-colors select-none",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    size === "sm" && "h-9 px-3 text-sm",
    size === "md" && "h-11 px-4 text-[15px]",
    size === "lg" && "h-13 px-5 text-base",
    variant === "primary" && "bg-ink text-white hover:bg-ink/88 active:bg-ink/80",
    variant === "secondary" && "border border-line-strong bg-surface text-ink hover:bg-sunk active:bg-sunk",
    variant === "ghost" && "text-ink hover:bg-ink/8 active:bg-ink/12",
    variant === "danger" && "bg-bad text-white hover:bg-bad/90",
    variant === "group" && "wristband border border-ink/20 hover:brightness-95",
    className,
  );
}

export function Button({
  variant,
  size,
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />;
}

/* ───────────── Surfaces ───────────── */

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("rounded-[14px] border border-line bg-surface", className)} />;
}

export function CardHeader({
  title,
  detail,
  action,
  className,
}: {
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-4 pt-4 sm:px-5", className)}>
      <div className="min-w-0">
        <h2 className="eyebrow text-ink-2">{title}</h2>
        {detail ? <p className="mt-1 text-sm text-ink-2">{detail}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  lede,
  actions,
  back,
}: {
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-5 sm:mb-6">
      {back ? (
        <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">
          <span aria-hidden>←</span> {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="board text-[2.1rem] sm:text-[2.6rem]">{title}</h1>
          {lede ? <p className="mt-2 max-w-[62ch] text-[15px] text-ink-2">{lede}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-2.5 flex items-center justify-between gap-3", className)}>
      <h2 className="eyebrow text-ink-2">{children}</h2>
      {action}
    </div>
  );
}

/* ───────────── Run group + car identity ───────────── */

export function groupStyle(group?: Pick<GroupLite, "color" | "textColor"> | null): CSSProperties {
  return { "--group": group?.color ?? "#14171a", "--group-ink": group?.textColor ?? "#ffffff" } as CSSProperties;
}

export function GroupChip({
  group,
  size = "md",
  className,
}: {
  group?: Pick<GroupLite, "name" | "color" | "textColor"> | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  if (!group) return null;
  return (
    <span
      style={groupStyle(group)}
      className={cn(
        "wristband inline-flex items-center rounded-md border border-ink/25 font-display font-extrabold tracking-[0.06em] whitespace-nowrap uppercase",
        size === "sm" && "h-5 px-1.5 text-[11px]",
        size === "md" && "h-6 px-2 text-[13px]",
        size === "lg" && "h-8 px-3 text-base",
        className,
      )}
    >
      {group.name}
    </span>
  );
}

/** Door-number plate. */
export function CarNumber({ n, size = "md", className }: { n?: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  if (!n) return null;
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-md border-2 border-ink bg-white font-display leading-none font-extrabold text-ink tabular-nums",
        size === "sm" && "h-6 min-w-8 px-1 text-[15px]",
        size === "md" && "h-8 min-w-10 px-1.5 text-xl",
        size === "lg" && "h-11 min-w-14 px-2 text-3xl",
        className,
      )}
      aria-label={`Car number ${n}`}
    >
      {n}
    </span>
  );
}

/* ───────────── Status ───────────── */

export type Tone = "neutral" | "info" | "warn" | "good" | "bad";

const toneClass: Record<Tone, string> = {
  neutral: "bg-sunk text-ink-2",
  info: "bg-info-soft text-info",
  warn: "bg-warn-soft text-warn",
  good: "bg-good-soft text-good",
  bad: "bg-bad-soft text-bad",
};

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold whitespace-nowrap", toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[12px] px-4 py-3 text-[15px]", toneClass[tone], className)} role={tone === "bad" ? "alert" : undefined}>
      {title ? <p className="font-bold">{title}</p> : null}
      {children ? <div className={cn("text-ink", title && "mt-0.5")}>{children}</div> : null}
    </div>
  );
}

/* ───────────── Forms ───────────── */

export function Field({
  label,
  hint,
  error,
  children,
  className,
  optional,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  optional?: boolean;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-semibold text-ink">
        <span>{label}</span>
        {optional ? <span className="font-normal text-ink-3">Optional</span> : null}
      </span>
      {children}
      {hint && !error ? <span className="mt-1.5 block text-[13px] text-ink-2">{hint}</span> : null}
      {error ? <span className="mt-1.5 block text-[13px] font-semibold text-bad">{error}</span> : null}
    </label>
  );
}

export function CheckRow({
  children,
  className,
  ...props
}: Omit<ComponentProps<"input">, "type"> & { children: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 py-1 text-[15px]", className)}>
      <input type="checkbox" {...props} className="check mt-0.5" />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

/* ───────────── Lists ───────────── */

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-dashed border-line-strong px-5 py-8 text-center">
      <p className="font-bold">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-[46ch] text-[15px] text-ink-2">{children}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const parts = name.split(" ").filter(Boolean);
  const text = `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase();
  return (
    <span aria-hidden className={cn("inline-grid size-9 shrink-0 place-items-center rounded-full bg-sunk text-[13px] font-bold text-ink-2", className)}>
      {text}
    </span>
  );
}

export function Stat({ label, value, sub, tone, href }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; href?: string }) {
  const body = (
    <>
      <p className="eyebrow text-ink-2">{label}</p>
      <p className={cn("board mt-1.5 text-[2.4rem]", tone === "bad" && "text-bad", tone === "warn" && "text-warn", tone === "good" && "text-good")}>{value}</p>
      {sub ? <p className="mt-1 text-[13px] text-ink-2">{sub}</p> : null}
    </>
  );
  const cls = "block rounded-[14px] border border-line bg-surface px-4 py-3.5";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-ink")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function DefList({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line text-[15px]", className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="flex gap-4 py-2.5">
          <dt className="w-32 shrink-0 text-ink-2 sm:w-40">{k}</dt>
          <dd className="min-w-0 flex-1 font-medium break-words">{v || <span className="font-normal text-ink-3">Not provided</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ───────────── Navigation within a screen ───────────── */

/** Link-based tabs: state lives in the URL, so they work without JavaScript and survive a refresh. */
export function Segmented({
  items,
  current,
  className,
  label,
}: {
  items: { href: string; label: ReactNode; key: string; count?: number }[];
  current: string;
  className?: string;
  label?: string;
}) {
  return (
    <nav aria-label={label} className={cn("no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)}>
      <ul className="inline-flex gap-1 rounded-[12px] border border-line bg-surface p-1">
        {items.map((item) => {
          const active = item.key === current;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-sm font-semibold whitespace-nowrap transition-colors",
                  active ? "bg-ink text-white" : "text-ink-2 hover:bg-sunk hover:text-ink",
                )}
              >
                {item.label}
                {item.count !== undefined ? (
                  <span className={cn("timing rounded-full px-1.5 text-[11px] font-bold", active ? "bg-white/20" : "bg-sunk")}>{item.count}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
