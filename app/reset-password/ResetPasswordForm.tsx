'use client';

import { useState } from 'react';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../lib/passwordPolicy';

export function ResetPasswordForm({ token }: { token: string }) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <form action="/api/auth/reset-password" method="post" onSubmit={() => setIsSubmitting(true)}>
      <input name="token" type="hidden" value={token} />
      <label>
        New password
        <input autoComplete="new-password" maxLength={PASSWORD_MAX_LENGTH} minLength={PASSWORD_MIN_LENGTH} name="password" required type="password" />
      </label>
      <label>
        Confirm new password
        <input autoComplete="new-password" maxLength={PASSWORD_MAX_LENGTH} minLength={PASSWORD_MIN_LENGTH} name="confirmPassword" required type="password" />
      </label>
      <button aria-busy={isSubmitting} disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Resetting password…' : 'Reset password'}
      </button>
    </form>
  );
}
