import type { ComponentProps, ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";

/**
 * One field of a form: a label over a control, a helper under it, and the
 * error under that — tied to the control with `aria-describedby`, in
 * `--status-danger` (`docs/ui/screens/README.md`, form fields). Every form in
 * the product is built from it, so a message renders the same way wherever a
 * person meets one.
 */

/** The DOM id of the control reporting under an error key. */
export function fieldId(name: string): string {
  return `field-${name.replaceAll(".", "-")}`;
}

/** What a `Field` hands its control: the wiring, and nothing about looks. */
export type Control = {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
};

/**
 * The control is a render prop so it can be an `Input`, a `Textarea` or a
 * `Select` trigger and still get the same wiring.
 */
export function Field({
  name,
  label,
  optional,
  helper,
  error,
  className,
  labelClassName,
  children,
}: {
  name: string;
  label: string;
  optional?: boolean;
  helper?: string;
  error?: string;
  className?: string;
  labelClassName?: string;
  children: (control: Control) => ReactNode;
}) {
  const id = fieldId(name);
  const describedBy =
    [helper ? `${id}-helper` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label
        htmlFor={id}
        className={cn(
          "text-xs leading-none font-medium text-text-secondary",
          labelClassName,
        )}
      >
        {label}
        {optional ? (
          <span className="font-normal text-text-muted">(optional)</span>
        ) : null}
      </Label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {helper ? (
        <p id={`${id}-helper`} className="text-xs leading-snug text-text-muted">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p
          id={`${id}-error`}
          className="text-xs leading-snug text-status-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * An amount, typed as text. Not `type="number"`, which would round, drop the
 * `$` and the commas a person naturally types, and let a scroll wheel change a
 * purchase price. `parseMoney` reads it, and refuses rather than rounds.
 */
export function MoneyInput(props: ComponentProps<typeof Input>) {
  return (
    <Input
      inputMode="decimal"
      autoComplete="off"
      placeholder="$0"
      {...props}
      className={cn("font-mono tabular-nums", props.className)}
    />
  );
}
