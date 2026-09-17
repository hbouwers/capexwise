/**
 * `?task=` with an id that is not one of this org's tasks
 * (`docs/ui/screens/modal-task-detail.md`, states): the page renders without
 * the modal, and this line at the top of its body. The same line for a task
 * that does not exist and one in another org, as the contact book's.
 */
export function TaskNotFound() {
  return (
    <p
      role="status"
      className="rounded-md border border-border-card bg-surface-subtle px-4 py-3 text-sm leading-normal text-text-secondary"
    >
      That task wasn’t found.
    </p>
  );
}
