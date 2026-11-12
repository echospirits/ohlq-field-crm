'use client';

import { useState, type ReactNode } from 'react';
import { ActionForm } from '../components/ActionForm';
import { recordReceiptAction } from './actions';

// Keep a draft and its submission identity stable when other order actions refresh the page.
export function ReceiptForm({ initialKey, children }: { initialKey: string; children: ReactNode }) {
  const [submissionKey, setSubmissionKey] = useState(initialKey);
  const [saved, setSaved] = useState(false);
  if (saved) return <div role="status"><p>Receipt recorded. Related needs remain open until explicitly resolved.</p><button className="secondary" type="button" onClick={() => { setSubmissionKey(crypto.randomUUID()); setSaved(false); }}>Record another receipt</button></div>;
  return <ActionForm action={recordReceiptAction} className="supply-edit-form" onSuccess={() => setSaved(true)}><input type="hidden" name="idempotencyKey" value={submissionKey} />{children}</ActionForm>;
}
