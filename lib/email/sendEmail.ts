import { Resend } from 'resend';

let resendClient: Resend | null = null;

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
};

export type SendEmailResult = {
  providerMessageId?: string;
};

export type SendEmailFn = (input: SendEmailInput) => Promise<SendEmailResult>;

const getRequiredEmailEnv = () => {
  const resendApiKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.EMAIL_FROM;
  const appBaseUrl = process.env.APP_BASE_URL;

  const missing = [
    resendApiKey ? null : 'RESEND_API_KEY',
    emailFrom ? null : 'EMAIL_FROM',
    appBaseUrl ? null : 'APP_BASE_URL',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing email environment variables: ${missing.join(', ')}`);
  }

  return {
    appBaseUrl: appBaseUrl!,
    emailFrom: emailFrom!,
    resendApiKey: resendApiKey!,
  };
};

const getResend = () => {
  const { resendApiKey } = getRequiredEmailEnv();

  if (!resendClient) {
    resendClient = new Resend(resendApiKey);
  }

  return resendClient;
};

export const getEmailAppBaseUrl = (options?: { allowLocalFallback?: boolean }) => {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/+$/, '');
  }

  if (options?.allowLocalFallback) {
    return 'http://localhost:3000';
  }

  throw new Error('Missing email environment variable: APP_BASE_URL');
};

export const sendEmail: SendEmailFn = async ({ to, subject, html, text, idempotencyKey }) => {
  const { emailFrom } = getRequiredEmailEnv();
  const { data, error } = await getResend().emails.send(
    {
      from: emailFrom,
      to,
      subject,
      html,
      text,
    },
    idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined,
  );

  if (error) {
    throw new Error(typeof error === 'string' ? error : error.message || 'Email provider failed to send');
  }

  return { providerMessageId: data?.id };
};
