import { createHash, randomBytes } from 'crypto';
import { APP_NAME } from './appBrand';
import { getEmailAppBaseUrl, sendEmail, type SendEmailFn } from './email/sendEmail';

export const PASSWORD_RESET_HOURS = 1;
export const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;

export const hashPasswordResetToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

export const isValidPasswordResetToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

export function createPasswordResetToken(now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_HOURS * 60 * 60 * 1000);

  return { expiresAt, token, tokenHash: hashPasswordResetToken(token) };
}

export const getPasswordResetUrl = (token: string, appBaseUrl = getEmailAppBaseUrl()) =>
  `${appBaseUrl.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`;

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

export function renderPasswordResetEmail({ resetUrl }: { resetUrl: string }) {
  const safeUrl = escapeHtml(resetUrl);
  const subject = `Reset your ${APP_NAME} password`;
  const text = [
    `We received a request to reset your ${APP_NAME} password.`,
    '',
    `Choose a new password using this link: ${resetUrl}`,
    '',
    `This link expires in ${PASSWORD_RESET_HOURS} hour and can only be used once.`,
    'If you did not request a password reset, you can ignore this email.',
  ].join('\n');
  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#172033;">
        <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
          <div style="background:#ffffff;border:1px solid #e1e6ed;border-radius:12px;padding:28px;">
            <h1 style="margin:0 0 16px;font-size:24px;">Reset your ${APP_NAME} password</h1>
            <p style="margin:0 0 22px;line-height:1.5;">
              We received a request to reset your password. Use the button below to choose a new one.
            </p>
            <p style="margin:0 0 24px;">
              <a href="${safeUrl}" style="display:inline-block;padding:12px 18px;background:#2458ff;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">
                Reset my password
              </a>
            </p>
            <p style="margin:0;color:#5f6b7a;font-size:13px;line-height:1.5;">
              This link expires in ${PASSWORD_RESET_HOURS} hour and can only be used once.
              If you did not request a password reset, you can ignore this email.
            </p>
            <p style="margin:20px 0 0;color:#7c8798;font-size:12px;">${APP_NAME}</p>
          </div>
        </div>
      </body>
    </html>
  `;

  return { html, subject, text };
}

export async function sendPasswordResetEmail({
  appBaseUrl,
  emailSender = sendEmail,
  recipientEmail,
  resetRequestId,
  token,
}: {
  appBaseUrl?: string;
  emailSender?: SendEmailFn;
  recipientEmail: string;
  resetRequestId: string;
  token: string;
}) {
  const resetUrl = getPasswordResetUrl(token, appBaseUrl);

  return emailSender({
    to: recipientEmail,
    ...renderPasswordResetEmail({ resetUrl }),
    idempotencyKey: `password-reset-${resetRequestId}`,
  });
}
