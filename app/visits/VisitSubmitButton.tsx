'use client';

export function VisitSubmitButton({
  disabled = false,
  label,
  pending,
}: {
  disabled?: boolean;
  label: string;
  pending: boolean;
}) {
  return (
    <button aria-live="polite" disabled={disabled || pending} type="submit">
      {pending ? 'Saving…' : label}
    </button>
  );
}
