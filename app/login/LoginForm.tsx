'use client';

import { useRef, useState } from 'react';

export function LoginForm() {
  const emailInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [requestMessage, setRequestMessage] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);

  const requestPasswordReset = async () => {
    if (!emailInput.current?.checkValidity()) {
      emailInput.current?.reportValidity();
      return;
    }

    setIsRequesting(true);
    setRequestMessage('');
    setRequestFailed(false);

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const result = await response.json() as { message?: string };

      if (!response.ok) {
        setRequestFailed(true);
        setRequestMessage(result.message ?? 'Enter a valid email address.');
      } else {
        setRequestMessage(result.message ?? 'If an active account uses that email, a password reset link will arrive shortly.');
      }
    } catch {
      setRequestFailed(true);
      setRequestMessage('We could not submit the request. Check your connection and try again.');
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <form action="/api/auth/login" method="post">
      <label>
        Email
        <input
          ref={emailInput}
          autoComplete="email"
          maxLength={254}
          name="email"
          onChange={(event) => {
            setEmail(event.target.value);
            setRequestMessage('');
            setRequestFailed(false);
          }}
          required
          type="email"
          value={email}
        />
      </label>
      <label>
        Password
        <input autoComplete="current-password" name="password" type="password" required />
      </label>
      <button type="submit">Sign in</button>
      <button
        className="link-button login-forgot-button"
        disabled={isRequesting}
        aria-busy={isRequesting}
        onClick={requestPasswordReset}
        type="button"
      >
        {isRequesting ? 'Sending reset link…' : 'Forgot password?'}
      </button>
      {requestMessage ? (
        <p aria-live="polite" className={requestFailed ? 'form-error' : 'muted'} role={requestFailed ? 'alert' : 'status'}>
          {requestMessage}
        </p>
      ) : null}
    </form>
  );
}
