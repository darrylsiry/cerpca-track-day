"use client";

import { LoaderCircle } from "lucide-react";
import {
  createContext,
  use,
  useRef,
  useState,
  useTransition,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/lib/types";
import { useSheetClose } from "./sheet";
import { toast } from "./toast";
import { buttonClass, Notice } from "./ui";

export type FormAction = (
  prev: ActionResult | null,
  formData: FormData,
) => Promise<ActionResult>;

/** True while the enclosing ActionForm's action is running. */
const PendingContext = createContext(false);

/**
 * Run a Server Action from a form's `onSubmit` and keep its latest result.
 * Returns `[state, onSubmit, pending]`.
 *
 * Use this instead of React's `<form action>` for anything a person fills in:
 *
 * - React resets the form when a form action finishes, even when it returned an
 *   error. Selects and checkboxes fall back to their first values while the
 *   component's state still holds what the person chose, so the screen and the
 *   next submit disagree. Submitting by hand leaves every field as it was.
 * - `onResult` runs as soon as the action returns, not in an effect. Saving often
 *   removes the form from the page (a row leaves a list, a sheet's content
 *   changes), and an effect on a form that has gone never runs, so the
 *   confirmation would be lost.
 */
export function useSubmit<S>(
  action: (prev: S, formData: FormData) => Promise<S>,
  initial: S,
  onResult?: (result: S) => void,
) {
  const [state, setState] = useState(initial);
  const [pending, start] = useTransition();
  const latest = useRef(initial);
  const busy = useRef(false);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // One at a time: a second Enter while the first is still saving is dropped.
    if (busy.current) return;
    const formData = new FormData(e.currentTarget);
    const submitter = (e.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    if (submitter?.name) formData.set(submitter.name, submitter.value);
    busy.current = true;
    start(async () => {
      try {
        const result = await action(latest.current, formData);
        latest.current = result;
        onResult?.(result);
        setState(result);
      } finally {
        busy.current = false;
      }
    });
  };

  return [state, onSubmit, pending] as const;
}

/**
 * A form bound to a Server Action that returns an ActionResult.
 * Shows the error inline, confirms success with a toast, and (inside a Sheet) closes it.
 */
export function ActionForm({
  action,
  children,
  className,
  closeOnSuccess = true,
  resetOnSuccess = false,
  onSuccess,
  quiet,
  ...rest
}: Omit<ComponentProps<"form">, "action" | "children"> & {
  action: FormAction;
  children: ReactNode;
  closeOnSuccess?: boolean;
  resetOnSuccess?: boolean;
  onSuccess?: (result: ActionResult & { ok: true }) => void;
  /** Suppress the success toast (the page change is its own confirmation). */
  quiet?: boolean;
}) {
  const closeSheet = useSheetClose();
  const formRef = useRef<HTMLFormElement>(null);
  const { onSubmit, ...formProps } = rest;
  const [state, submit, pending] = useSubmit<ActionResult | null>(
    action,
    null,
    (result) => {
      if (!result?.ok) return;
      if (!quiet) toast(result.message ?? "Saved");
      if (resetOnSuccess) formRef.current?.reset();
      onSuccess?.(result);
      if (closeOnSuccess) closeSheet();
    },
  );

  return (
    <form
      ref={formRef}
      className={className}
      {...formProps}
      onSubmit={(e) => {
        onSubmit?.(e);
        if (!e.defaultPrevented) submit(e);
      }}
    >
      <PendingContext value={pending}>
        {children}
        {state && !state.ok ? (
          <Notice tone="bad" className="mt-4">
            {state.error}
          </Notice>
        ) : null}
      </PendingContext>
    </form>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & {
  pendingLabel?: string;
  variant?: Parameters<typeof buttonClass>[0];
  size?: Parameters<typeof buttonClass>[1];
}) {
  const status = useFormStatus();
  const pending = use(PendingContext) || status.pending;
  return (
    <button
      type="submit"
      {...props}
      disabled={pending || props.disabled}
      className={buttonClass(variant, size, className)}
    >
      {pending ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
      ) : null}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

/**
 * A single button that runs a Server Action directly (approve, check in, mark read…).
 * `confirm` asks first for anything that can't be undone.
 */
export function ActionButton({
  action,
  children,
  confirm,
  successMessage,
  variant = "secondary",
  size = "md",
  className,
  onDone,
  ...props
}: Omit<ComponentProps<"button">, "onClick"> & {
  action: () => Promise<ActionResult>;
  confirm?: string;
  successMessage?: string | false;
  variant?: Parameters<typeof buttonClass>[0];
  size?: Parameters<typeof buttonClass>[1];
  onDone?: () => void;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      {...props}
      disabled={pending || props.disabled}
      className={cn(buttonClass(variant, size, className))}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const result = await action();
          if (!result.ok) toast(result.error, "bad");
          else {
            if (successMessage !== false)
              toast(successMessage ?? result.message ?? "Done");
            onDone?.();
          }
        });
      }}
    >
      {pending ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
      ) : null}
      {children}
    </button>
  );
}
