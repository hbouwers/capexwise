"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/dates";
import type { FieldErrors } from "@/lib/forms";
import { type NewTaskFields, validateNewTask } from "@/lib/task-form";
import { FREQUENCIES, frequencyLabel } from "@/lib/tasks";
import { addTask } from "@/server/actions/tasks";

type Building = {
  id: string;
  name: string;
  /** Not retired, in label order. */
  units: { id: string; label: string }[];
};

const SAVE_FAILED = "Couldn’t add the task. Try again.";

/**
 * The building page's inline add row (`docs/ui/screens/building-detail.md`):
 * a title, a frequency, and `Add task`. The task is first due one interval
 * from today, which the toast says; the task modal changes it.
 *
 * A scope on a building with more than one unit, `Shared` by default. After an
 * add the title clears and keeps the focus, so a list of jobs goes in one
 * after another.
 */
export function AddTaskForm({ building }: { building: Building }) {
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [fields, setFields] = useState<NewTaskFields>({
    title: "",
    buildingId: building.id,
    scope: "shared",
    recurrence: "12",
  });

  const chooseScope = building.units.length > 1;

  function change(next: Partial<NewTaskFields>) {
    setFields((current) => ({ ...current, ...next }));
    // A message about a field goes once the field has changed.
    setErrors((current) => {
      const kept = { ...current };
      for (const key of Object.keys(next)) delete kept[key];
      return kept;
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    const checked = validateNewTask(fields);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }

    setErrors({});
    startTransition(async () => {
      const result = await addTask(fields).catch(() => null);

      if (result === null) {
        setErrors({ form: SAVE_FAILED });
        return;
      }
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }

      const title = checked.values.title;
      setFields((current) => ({ ...current, title: "" }));
      form.querySelector<HTMLInputElement>("input[name=title]")?.focus();
      router.refresh();
      toast.success(
        result.dueDate
          ? `${title}: first due ${formatDate(result.dueDate)}.`
          : `${title}: added to Unscheduled.`,
      );
    });
  }

  const name = (field: string) => `${id}-${field}`;

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Add a recurring task"
      className="flex flex-col gap-2 px-5 py-4"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        <Field
          name={name("title")}
          label="Recurring task"
          error={errors.title}
          className="md:flex-1"
        >
          {(control) => (
            <Input
              {...control}
              name="title"
              value={fields.title}
              onChange={(event) => change({ title: event.target.value })}
              placeholder="Add a recurring task — e.g. seal the driveway"
              autoComplete="off"
            />
          )}
        </Field>

        <Field name={name("frequency")} label="Repeats" className="md:w-44">
          {(control) => (
            <Select
              value={fields.recurrence}
              onValueChange={(next) => change({ recurrence: next })}
            >
              <SelectTrigger {...control} className="w-full">
                <SelectValue>
                  {frequencyLabel(Number(fields.recurrence))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent position="popper">
                {FREQUENCIES.map((months) => (
                  <SelectItem key={months} value={String(months)}>
                    {frequencyLabel(months)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>

        {chooseScope ? (
          <Field name={name("scope")} label="Scope" className="md:w-36">
            {(control) => (
              <Select
                value={fields.scope}
                onValueChange={(next) => change({ scope: next })}
              >
                <SelectTrigger {...control} className="w-full">
                  <SelectValue>
                    {building.units.find((unit) => unit.id === fields.scope)
                      ?.label ?? "Shared"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="shared">Shared</SelectItem>
                  {building.units.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {unit.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        ) : null}

        {/* Level with the fields rather than their labels, from `md` up. */}
        <Button
          type="submit"
          variant="outline"
          disabled={pending}
          className="self-start md:mt-5.5"
        >
          Add task
        </Button>
      </div>

      {errors.form ? (
        <p role="alert" className="text-xs leading-snug text-status-danger">
          {errors.form}
        </p>
      ) : null}
    </form>
  );
}
