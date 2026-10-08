import assert from 'node:assert/strict';
import test from 'node:test';
import type { SendEmailInput } from '../lib/email/sendEmail';
import {
  createPasswordResetToken,
  getPasswordResetUrl,
  hashPasswordResetToken,
  isValidPasswordResetToken,
  PASSWORD_RESET_HOURS,
  renderPasswordResetEmail,
  sendPasswordResetEmail,
} from '../lib/passwordReset';

test('password reset tokens are hashed and expire after one hour', () => {
  const now = new Date('2026-09-23T12:00:00.000Z');
  const reset = createPasswordResetToken(now);

  assert.notEqual(reset.token, reset.tokenHash);
  assert.equal(reset.tokenHash, hashPasswordResetToken(reset.token));
  assert.equal(reset.token.length, 43);
  assert.equal(isValidPasswordResetToken(reset.token), true);
  assert.equal(isValidPasswordResetToken('not-a-reset-token'), false);
  assert.equal(reset.expiresAt.getTime(), now.getTime() + PASSWORD_RESET_HOURS * 60 * 60 * 1000);
});

test('password reset email contains an encoded one-time URL and expiry instructions', () => {
  const resetUrl = getPasswordResetUrl('token with spaces', 'https://crm.example.com/');
  const rendered = renderPasswordResetEmail({ resetUrl });

  assert.equal(resetUrl, 'https://crm.example.com/reset-password?token=token%20with%20spaces');
  assert.match(rendered.subject, /reset your .* password/i);
  assert.match(rendered.text, /expires in 1 hour/i);
  assert.match(rendered.text, /ignore this email/i);
  assert.match(rendered.html, /Reset my password/);
  assert.match(rendered.html, /token%20with%20spaces/);
});

test('password reset email uses a stable per-request idempotency key', async () => {
  let sent: SendEmailInput | undefined;

  await sendPasswordResetEmail({
    appBaseUrl: 'https://crm.example.com',
    emailSender: async (input) => {
      sent = input;
      return { providerMessageId: 'email-123' };
    },
    recipientEmail: 'alex@example.com',
    resetRequestId: 'reset-123',
    token: 'fresh-token',
  });

  assert.ok(sent);
  assert.equal(sent.to, 'alex@example.com');
  assert.equal(sent.idempotencyKey, 'password-reset-reset-123');
  assert.match(sent.text, /fresh-token/);
});
