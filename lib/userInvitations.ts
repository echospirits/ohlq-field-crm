import { createHash, randomBytes } from 'crypto';
import { APP_COMPANY, APP_NAME } from './appBrand';
import { getEmailAppBaseUrl, sendEmail, type SendEmailFn } from './email/sendEmail';

export const USER_INVITATION_HOURS = 72;

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

export const hashUserInvitationToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

export function createUserInvitationToken(now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + USER_INVITATION_HOURS * 60 * 60 * 1000);

  return {
    expiresAt,
    token,
    tokenHash: hashUserInvitationToken(token),
  };
}

export const getUserInvitationUrl = (token: string, appBaseUrl = getEmailAppBaseUrl()) =>
  `${appBaseUrl.replace(/\/+$/, '')}/accept-invite?token=${encodeURIComponent(token)}`;

export function renderUserInvitationEmail({
  inviteUrl,
  isReminder = false,
  organizationName = APP_COMPANY,
  recipientName,
}: {
  inviteUrl: string;
  isReminder?: boolean;
  organizationName?: string;
  recipientName: string;
}) {
  const safeName = escapeHtml(recipientName);
  const safeUrl = escapeHtml(inviteUrl);
  const subject = isReminder
    ? `Reminder: finish setting up your ${APP_NAME} account`
    : `You're invited to ${APP_NAME}`;
  const text = [
    `Hello ${recipientName},`,
    '',
    isReminder
      ? `This is a reminder to finish setting up your ${APP_NAME} account.`
      : `You've been invited to ${APP_NAME} by ${organizationName}.`,
    `Create your ${APP_NAME} password using this link:`,
    inviteUrl,
    '',
    `This link expires in ${USER_INVITATION_HOURS} hours and can only be used once.`,
    'If you were not expecting this invitation, you can ignore this email.',
  ].join('\n');
  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#172033;">
        <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
          <div style="background:#ffffff;border:1px solid #e1e6ed;border-radius:12px;padding:28px;">
            <h1 style="margin:0 0 16px;font-size:24px;">
              ${isReminder ? `Finish setting up your ${APP_NAME} account` : `You're invited to ${APP_NAME}`}
            </h1>
            <p style="margin:0 0 12px;">Hello ${safeName},</p>
            <p style="margin:0 0 22px;line-height:1.5;">
              Create your ${APP_NAME} password to finish setting up your account.
            </p>
            <p style="margin:0 0 24px;">
              <a href="${safeUrl}" style="display:inline-block;padding:12px 18px;background:#2458ff;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">
                Create my password
              </a>
            </p>
            <p style="margin:0;color:#5f6b7a;font-size:13px;line-height:1.5;">
              This link expires in ${USER_INVITATION_HOURS} hours and can only be used once.
              If you were not expecting this invitation, you can ignore this email.
            </p>
            <p style="margin:20px 0 0;color:#7c8798;font-size:12px;">${APP_NAME} · ${escapeHtml(organizationName)}</p>
          </div>
        </div>
      </body>
    </html>
  `;

  return { html, subject, text };
}

export async function sendUserInvitationEmail({
  appBaseUrl,
  emailSender = sendEmail,
  invitationId,
  isReminder = false,
  organizationName,
  recipientEmail,
  recipientName,
  token,
}: {
  appBaseUrl?: string;
  emailSender?: SendEmailFn;
  invitationId: string;
  isReminder?: boolean;
  organizationName?: string;
  recipientEmail: string;
  recipientName: string;
  token: string;
}) {
  const inviteUrl = getUserInvitationUrl(token, appBaseUrl);
  const rendered = renderUserInvitationEmail({ inviteUrl, isReminder, organizationName, recipientName });

  return emailSender({
    to: recipientEmail,
    ...rendered,
    idempotencyKey: `${isReminder ? 'user-activation-reminder' : 'user-invitation'}-${invitationId}`,
  });
}
