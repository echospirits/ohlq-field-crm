export const APP_ENVIRONMENTS = ['production', 'test', 'development'] as const;

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];
export type SideEffect = 'calendar' | 'cron' | 'email' | 'fileUploads' | 'ohlqImport' | 'webhookRegistration';

const SIDE_EFFECT_VARIABLES: Record<SideEffect, string> = {
  calendar: 'CALENDAR_SYNC_ENABLED',
  cron: 'CRON_JOBS_ENABLED',
  email: 'EMAIL_SEND_ENABLED',
  fileUploads: 'FILE_UPLOADS_ENABLED',
  ohlqImport: 'OHLQ_IMPORT_ENABLED',
  webhookRegistration: 'WEBHOOK_REGISTRATION_ENABLED',
};

const normalize = (value: string | undefined) => value?.trim().toLowerCase();

export function parseBooleanEnvironmentValue(value: string | undefined, name: string) {
  const normalized = normalize(value);
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${name} must be true or false.`);
}

export function getAppEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  const configured = normalize(env.APP_ENV);
  if (configured && APP_ENVIRONMENTS.includes(configured as AppEnvironment)) return configured as AppEnvironment;
  if (configured) throw new Error(`APP_ENV must be one of: ${APP_ENVIRONMENTS.join(', ')}.`);
  if (env.VERCEL === '1') throw new Error('APP_ENV is required for every Vercel deployment.');
  return 'development';
}

export function getEnvironmentLabel(env: NodeJS.ProcessEnv = process.env) {
  const appEnvironment = getAppEnvironment(env);
  return appEnvironment === 'production' ? 'Production' : appEnvironment === 'test' ? 'Test' : 'Development';
}

export function isSideEffectEnabled(effect: SideEffect, env: NodeJS.ProcessEnv = process.env) {
  const appEnvironment = getAppEnvironment(env);
  const explicit = parseBooleanEnvironmentValue(env[SIDE_EFFECT_VARIABLES[effect]], SIDE_EFFECT_VARIABLES[effect]);
  return explicit ?? (appEnvironment === 'production' && effect !== 'webhookRegistration');
}

export function getSideEffectPolicy(env: NodeJS.ProcessEnv = process.env) {
  return {
    calendar: isSideEffectEnabled('calendar', env),
    cron: isSideEffectEnabled('cron', env),
    email: isSideEffectEnabled('email', env),
    fileUploads: isSideEffectEnabled('fileUploads', env),
    ohlqImport: isSideEffectEnabled('ohlqImport', env),
    webhookRegistration: isSideEffectEnabled('webhookRegistration', env),
  };
}

export function assertSideEffectEnabled(effect: SideEffect, env: NodeJS.ProcessEnv = process.env) {
  if (!isSideEffectEnabled(effect, env)) {
    throw new Error(`${effect} side effects are disabled in the ${getAppEnvironment(env)} environment.`);
  }
}

const requireMatchingResourceEnvironment = (name: string, appEnvironment: AppEnvironment, env: NodeJS.ProcessEnv) => {
  const resourceEnvironment = normalize(env[name]);
  if (!resourceEnvironment) throw new Error(`${name} is required when APP_ENV=${appEnvironment}.`);
  if (resourceEnvironment !== appEnvironment) {
    throw new Error(`${name}=${resourceEnvironment} does not match APP_ENV=${appEnvironment}.`);
  }
};

export function validateRuntimeEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const appEnvironment = getAppEnvironment(env);
  const baseUrl = env.APP_BASE_URL?.trim().replace(/\/+$/, '');
  const branch = env.VERCEL_GIT_COMMIT_REF?.trim();

  if (env.VERCEL === '1' && !baseUrl) throw new Error('APP_BASE_URL is required on Vercel.');
  if (appEnvironment !== 'development' || env.DATABASE_URL) {
    requireMatchingResourceEnvironment('DATABASE_ENVIRONMENT', appEnvironment, env);
  }
  if (appEnvironment !== 'development') {
    if (!env.DATABASE_URL?.trim()) throw new Error(`DATABASE_URL is required when APP_ENV=${appEnvironment}.`);
    if (!env.DATABASE_TARGET_ID?.trim()) throw new Error(`DATABASE_TARGET_ID is required when APP_ENV=${appEnvironment}.`);
    const expectedDatabaseHost = normalize(env.EXPECTED_DATABASE_HOST);
    if (!expectedDatabaseHost) throw new Error(`EXPECTED_DATABASE_HOST is required when APP_ENV=${appEnvironment}.`);
    let actualDatabaseHost: string;
    try {
      actualDatabaseHost = new URL(env.DATABASE_URL).hostname.toLowerCase();
    } catch {
      throw new Error('DATABASE_URL must be a valid Postgres URL.');
    }
    if (actualDatabaseHost !== expectedDatabaseHost) {
      throw new Error(`DATABASE_URL host ${actualDatabaseHost} does not match EXPECTED_DATABASE_HOST=${expectedDatabaseHost}.`);
    }
  }
  if (env.BLOB_READ_WRITE_TOKEN) {
    requireMatchingResourceEnvironment('BLOB_ENVIRONMENT', appEnvironment, env);
  }
  if (env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET || env.GOOGLE_REDIRECT_URI) {
    requireMatchingResourceEnvironment('OAUTH_ENVIRONMENT', appEnvironment, env);
    const redirectUri = env.GOOGLE_REDIRECT_URI?.trim().replace(/\/+$/, '');
    if (redirectUri && baseUrl && redirectUri !== `${baseUrl}/api/calendar/google/callback`) {
      throw new Error('GOOGLE_REDIRECT_URI must use APP_BASE_URL for this environment.');
    }
  }

  if (appEnvironment === 'production') {
    if (env.VERCEL === '1' && env.VERCEL_ENV !== 'production') {
      throw new Error('APP_ENV=production is allowed only in a Vercel Production deployment.');
    }
    if (branch && branch !== 'main') throw new Error(`APP_ENV=production cannot run from branch ${branch}.`);
  }

  if (appEnvironment === 'test') {
    if (branch && branch !== 'tst') throw new Error(`APP_ENV=test cannot run from branch ${branch}.`);
    const productionBaseUrl = env.PRODUCTION_BASE_URL?.trim().replace(/\/+$/, '');
    if (!productionBaseUrl) throw new Error('PRODUCTION_BASE_URL is required when APP_ENV=test.');
    if (baseUrl && baseUrl === productionBaseUrl) throw new Error('Test APP_BASE_URL must not equal PRODUCTION_BASE_URL.');
  }

  return { appEnvironment, baseUrl: baseUrl || 'http://localhost:3000', branch: branch || null };
}

export function getSafeDatabaseTarget(env: NodeJS.ProcessEnv = process.env) {
  return env.DATABASE_TARGET_ID?.trim() || `${getAppEnvironment(env)}-database-not-labeled`;
}

export function logEnvironmentEvent(event: string, details: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = process.env) {
  console.info(event, {
    environment: getAppEnvironment(env),
    databaseTarget: getSafeDatabaseTarget(env),
    ...details,
  });
}

export function assertDestructiveDatabaseOperationAllowed(env: NodeJS.ProcessEnv = process.env) {
  const { appEnvironment } = validateRuntimeEnvironment(env);
  if (appEnvironment === 'production') throw new Error('Destructive database operations are never allowed in production.');
  if (appEnvironment !== 'test') throw new Error(`Database reset is allowed only in test, not ${appEnvironment}.`);
  if (parseBooleanEnvironmentValue(env.ALLOW_DATABASE_RESET, 'ALLOW_DATABASE_RESET') !== true) {
    throw new Error('Set ALLOW_DATABASE_RESET=true for this one test-database reset.');
  }
}
