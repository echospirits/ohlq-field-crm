import { Resend } from 'resend';
import { getAppEnvironment, isSideEffectEnabled, logEnvironmentEvent, parseBooleanEnvironmentValue } from '../appEnvironment';

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
  suppressed?: boolean;
  deliveredTo?: string;
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

export const getEmailDeliveryPolicy = (env: NodeJS.ProcessEnv = process.env) => {
  const environment = getAppEnvironment(env);
  const enabled = isSideEffectEnabled('email', env);
  const overrideRecipient = env.EMAIL_OVERRIDE_RECIPIENT?.trim() || null;
  const captureContent = parseBooleanEnvironmentValue(env.EMAIL_CAPTURE_CONTENT, 'EMAIL_CAPTURE_CONTENT') === true;

  if (environment === 'production' && overrideRecipient) {
    throw new Error('EMAIL_OVERRIDE_RECIPIENT must not be set in production.');
  }
  if (environment !== 'production' && enabled && !overrideRecipient) {
    throw new Error('Non-production email sending requires EMAIL_OVERRIDE_RECIPIENT.');
  }

  return { captureContent, enabled, environment, overrideRecipient };
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
  const policy = getEmailDeliveryPolicy();
  const deliveredTo = policy.overrideRecipient || to;
  const deliveredSubject = policy.environment === 'production' ? subject : `[${policy.environment.toUpperCase()} for ${to}] ${subject}`;

  if (!policy.enabled) {
    logEnvironmentEvent('email.suppressed', {
      intendedRecipient: to,
      subject,
      ...(policy.captureContent ? { html, text } : { contentCaptured: false }),
    });
    return { deliveredTo, suppressed: true };
  }

  const { emailFrom } = getRequiredEmailEnv();
  const { data, error } = await getResend().emails.send(
    {
      from: emailFrom,
      to: deliveredTo,
      subject: deliveredSubject,
      html,
      text,
    },
    idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined,
  );

  if (error) {
    throw new Error(typeof error === 'string' ? error : error.message || 'Email provider failed to send');
  }

  logEnvironmentEvent('email.sent', { deliveredTo, intendedRecipient: to, providerMessageId: data?.id ?? null, subject });
  return { deliveredTo, providerMessageId: data?.id };
};
