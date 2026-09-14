'use client';

import { useEffect, type RefObject } from 'react';

export function useDialogFocus(ref: RefObject<HTMLElement>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open || !ref.current) return;
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
    const focusFirst = () => (dialog.querySelector<HTMLElement>('[autofocus]') ?? controls()[0])?.focus();
    focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const elements = controls();
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog.addEventListener('keydown', keydown);
    return () => { dialog.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [ref, open, onClose]);
}
