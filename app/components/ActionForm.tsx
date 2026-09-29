'use client';

import { createContext, useRef, useState, type ReactNode } from 'react';
import { unstable_rethrow } from 'next/navigation';

export type ActionResult = { error: string; refresh?: boolean } | { success: string };
export const ActionPendingContext = createContext(false);

// Keep validation failures beside the form and retain entered values for retry.
export function ActionForm({ action, children, className, onSuccess, onError }: {
  action: (data: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  onSuccess?: () => void;
  onError?: (message: string, refresh: boolean) => void;
}) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const submit = async (data: FormData) => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      const result = await action(data);
      if ('error' in result) {
        setError(result.error);
        onError?.(result.error, Boolean(result.refresh));
      }
      else {
        window.dispatchEvent(new CustomEvent('neat-action-success', { detail: result.success }));
        onSuccess?.();
      }
    } catch (cause) {
      unstable_rethrow(cause);
      const message = 'Could not confirm the save. Check the current record before retrying.';
      setError(message);
      onError?.(message, true);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  return <ActionPendingContext.Provider value={pending}><form className={className} aria-busy={pending} action={submit} onSubmit={(event) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    void submit(new FormData(event.currentTarget, submitter));
  }}>{children}{error ? <p className="notice danger" role="alert">{error}</p> : null}</form></ActionPendingContext.Provider>;
}
