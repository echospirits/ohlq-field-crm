'use client';

import { useContext, type ButtonHTMLAttributes } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionPendingContext } from './ActionForm';

export function SubmitButton({ children, disabled, pendingLabel = 'Working…', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { pendingLabel?: string }) {
  const { pending: formPending } = useFormStatus();
  const actionPending = useContext(ActionPendingContext);
  const pending = formPending || actionPending;
  return <button {...props} type="submit" disabled={disabled || pending} aria-busy={pending} aria-live="polite">{pending ? pendingLabel : children}</button>;
}
