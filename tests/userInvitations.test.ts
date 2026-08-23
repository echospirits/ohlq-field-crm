import assert from 'node:assert/strict';
import test from 'node:test';
import type { SendEmailInput } from '../lib/email/sendEmail';
import {
  createUserInvitationToken,
  getUserInvitationUrl,
  hashUserInvitationToken,
  renderUserInvitationEmail,
  sendUserInvitationEmail,
  USER_INVITATION_HOURS,
} from '../lib/userInvitations';

test('user invitation tokens are hashed and expire after 72 hours', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');
  const invitation = createUserInvitationToken(now);

  assert.notEqual(invitation.token, invitation.tokenHash);
  assert.equal(invitation.tokenHash, hashUserInvitationToken(invitation.token));
  assert.equal(
    invitation.expiresAt.getTime(),
    now.getTime() + USER_INVITATION_HOURS * 60 * 60 * 1000,
  );
});

test('invitation URL encodes the token and email includes the password setup action', () => {
  const inviteUrl = getUserInvitationUrl('token with spaces', 'https://crm.example.com/');
  const rendered = renderUserInvitationEmail({
    inviteUrl,
    recipientName: 'Alex & Taylor',
  });

  assert.equal(inviteUrl, 'https://crm.example.com/accept-invite?token=token%20with%20spaces');
  assert.match(rendered.subject, /invited/i);
  assert.match(rendered.subject, /Neat/);
  assert.match(rendered.text, /Create your .* password/i);
  assert.match(rendered.html, /Create my password/);
  assert.match(rendered.html, /Alex &amp; Taylor/);
  assert.match(rendered.html, /Neat · Echo Spirits/);
});

test('activation reminder clearly identifies itself and uses a unique reminder send key', async () => {
  let sent: SendEmailInput | undefined;

  await sendUserInvitationEmail({
    appBaseUrl: 'https://crm.example.com',
    emailSender: async (input) => {
      sent = input;
      return { providerMessageId: 'email-123' };
    },
    invitationId: 'invite-123',
    isReminder: true,
    recipientEmail: 'alex@example.com',
    recipientName: 'Alex Taylor',
    token: 'fresh-token',
  });

  assert.ok(sent);
  assert.match(sent.subject, /^Reminder:/);
  assert.match(sent.text, /reminder to finish setting up/i);
  assert.equal(sent.idempotencyKey, 'user-activation-reminder-invite-123');
});
