"use client";

import { LoaderCircle } from "lucide-react";
import {
  createContext,
  startTransition,
  use,
  useActionState,
  useEffect,
  useRef,
  useTransition,
  type ComponentProps,
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
  const [state, dispatch, pending] = useActionState(action, null);
  const closeSheet = useSheetClose();
  const formRef = useRef<HTMLFormElement>(null);
  const handled = useRef<ActionResult | null>(null);
  const { onSubmit, ...formProps } = rest;

  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) {
      if (!quiet) toast(state.message ?? "Saved");
      if (resetOnSuccess) formRef.current?.reset();
      onSuccess?.(state);
      if (closeOnSuccess) startTransition(() => closeSheet());
    }
  }, [state, quiet, resetOnSuccess, closeOnSuccess, onSuccess, closeSheet]);

  return (
    <form
      ref={formRef}
      className={className}
      {...formProps}
      // Submitted by hand rather than through `action=`: React clears every uncontrolled field
      // when a form action finishes, even when it returns an error, and nobody should have to
      // retype a long form (or re-draw a signature) because one field was wrong.
      onSubmit={(e) => {
        onSubmit?.(e);
        if (e.defaultPrevented) return;
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const submitter = (e.nativeEvent as SubmitEvent)
          .submitter as HTMLButtonElement | null;
        if (submitter?.name) formData.set(submitter.name, submitter.value);
        startTransition(() => dispatch(formData));
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
