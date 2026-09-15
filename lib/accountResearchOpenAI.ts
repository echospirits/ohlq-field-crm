import {
  ACCOUNT_RESEARCH_JSON_SCHEMA,
  ACCOUNT_RESEARCH_MAX_OUTPUT_TOKENS,
  ACCOUNT_RESEARCH_MAX_TOOL_CALLS,
  ACCOUNT_RESEARCH_PILOT_MODEL,
  buildAccountResearchPrompt,
  parseAccountResearchResult,
  type AccountResearchInputSnapshot,
} from './accountResearchPilot';
import { getAppEnvironment, isSideEffectEnabled, parseBooleanEnvironmentValue, validateRuntimeEnvironment } from './appEnvironment';

type ResearchFetch = typeof fetch;
export type AccountResearchExecutionMode = 'manual' | 'automatic';
const AUTOMATIC_RATE_LIMIT_RETRIES = 3;
const MAX_RATE_LIMIT_WAIT_MS = 10_000;

type OpenAIResponse = {
  id?: string;
  status?: string;
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{
    type?: string;
    action?: { sources?: Array<{ url?: string }> };
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
};

export type RetrievedResearchResponse = {
  responseId: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'incomplete' | string;
  result: ReturnType<typeof parseAccountResearchResult> | null;
  inputTokens: number;
  outputTokens: number;
  webSearchCalls: number;
  sourceUrls: string[];
  error: string | null;
};

export function getAccountResearchPilotAvailability(env: NodeJS.ProcessEnv = process.env) {
  const appEnvironment = getAppEnvironment(env);
  let enabled = false;
  let configurationError: string | null = null;
  try {
    enabled = parseBooleanEnvironmentValue(env.ACCOUNT_RESEARCH_PILOT_ENABLED, 'ACCOUNT_RESEARCH_PILOT_ENABLED') === true;
  } catch (error) {
    configurationError = error instanceof Error ? error.message : String(error);
  }
  const hasKey = Boolean(env.OPENAI_API_KEY?.trim());
  return {
    available: ['test', 'production'].includes(appEnvironment) && enabled && hasKey && !configurationError,
    appEnvironment,
    enabled,
    hasKey,
    configurationError,
  };
}

export function assertAccountResearchEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (!['test', 'production'].includes(getAppEnvironment(env))) throw new Error('Account research is restricted to deployed test or production environments.');
  const runtime = validateRuntimeEnvironment(env);
  if (parseBooleanEnvironmentValue(env.ACCOUNT_RESEARCH_PILOT_ENABLED, 'ACCOUNT_RESEARCH_PILOT_ENABLED') !== true) {
    throw new Error('The account research pilot is disabled.');
  }
  return { runtime };
}

export function getAccountResearchAutomationAvailability(env: NodeJS.ProcessEnv = process.env) {
  const appEnvironment = getAppEnvironment(env);
  let enabled = false;
  let configurationError: string | null = null;
  try {
    enabled = parseBooleanEnvironmentValue(env.ACCOUNT_RESEARCH_AUTOMATION_ENABLED, 'ACCOUNT_RESEARCH_AUTOMATION_ENABLED') === true;
  } catch (error) {
    configurationError = error instanceof Error ? error.message : String(error);
  }
  const hasKey = Boolean(env.OPENAI_API_KEY?.trim());
  const cronEnabled = isSideEffectEnabled('cron', env);
  return {
    available: appEnvironment === 'production' && enabled && hasKey && cronEnabled && !configurationError,
    appEnvironment,
    enabled,
    hasKey,
    cronEnabled,
    configurationError,
  };
}

export function assertAccountResearchAutomationEnabled(env: NodeJS.ProcessEnv = process.env) {
  const runtime = validateRuntimeEnvironment(env);
  if (runtime.appEnvironment !== 'production') throw new Error('Automatic account research is restricted to APP_ENV=production.');
  if (!isSideEffectEnabled('cron', env)) throw new Error('Automatic account research is disabled because cron side effects are off.');
  if (parseBooleanEnvironmentValue(env.ACCOUNT_RESEARCH_AUTOMATION_ENABLED, 'ACCOUNT_RESEARCH_AUTOMATION_ENABLED') !== true) {
    throw new Error('Automatic account research is disabled.');
  }
  if (!env.OPENAI_API_KEY?.trim()) throw new Error('OPENAI_API_KEY is not configured for production account research.');
  return { apiKey: env.OPENAI_API_KEY.trim(), runtime };
}

export function assertAccountResearchPilotEnabled(env: NodeJS.ProcessEnv = process.env) {
  const { runtime } = assertAccountResearchEnvironment(env);
  if (!env.OPENAI_API_KEY?.trim()) throw new Error('OPENAI_API_KEY is not configured for account research.');
  return { apiKey: env.OPENAI_API_KEY.trim(), runtime };
}

export function getRateLimitRetryDelayMs(response: Pick<Response, 'headers'>, message: string) {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(MAX_RATE_LIMIT_WAIT_MS, Math.max(1_000, Math.ceil(seconds * 1_000) + 500));
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.min(MAX_RATE_LIMIT_WAIT_MS, Math.max(1_000, at - Date.now() + 500));
  }
  const messageDelay = message.match(/try again in\s+([\d.]+)\s*(ms|s)/i);
  if (messageDelay) {
    const multiplier = messageDelay[2].toLowerCase() === 'ms' ? 1 : 1_000;
    return Math.min(MAX_RATE_LIMIT_WAIT_MS, Math.max(1_000, Math.ceil(Number(messageDelay[1]) * multiplier) + 500));
  }
  return 5_000;
}

async function requestOpenAI(path: string, init: RequestInit, fetchImpl: ResearchFetch = fetch, env: NodeJS.ProcessEnv = process.env, mode: AccountResearchExecutionMode = 'manual') {
  const { apiKey } = mode === 'automatic' ? assertAccountResearchAutomationEnabled(env) : assertAccountResearchPilotEnabled(env);
  const attempts = mode === 'automatic' ? AUTOMATIC_RATE_LIMIT_RETRIES + 1 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetchImpl(`https://api.openai.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({})) as OpenAIResponse & { error?: { message?: string } };
    if (response.ok) return payload;
    const message = payload.error?.message || `OpenAI request failed with HTTP ${response.status}.`;
    if (response.status === 429 && attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, getRateLimitRetryDelayMs(response, message)));
      continue;
    }
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  throw new Error('OpenAI request retry loop ended unexpectedly.');
}

export async function submitAccountResearch({
  input,
  tier,
  pilotId,
  jobId,
  fetchImpl,
  env,
  mode = 'manual',
}: {
  input: AccountResearchInputSnapshot;
  tier: 'LIGHTWEIGHT' | 'DEEP';
  pilotId: string;
  jobId: string;
  fetchImpl?: ResearchFetch;
  env?: NodeJS.ProcessEnv;
  mode?: AccountResearchExecutionMode;
}) {
  const response = await requestOpenAI('/responses', {
    method: 'POST',
    body: JSON.stringify({
      model: ACCOUNT_RESEARCH_PILOT_MODEL,
      background: true,
      store: true,
      input: buildAccountResearchPrompt(input, tier),
      tools: [{ type: 'web_search', search_context_size: 'low' }],
      max_tool_calls: ACCOUNT_RESEARCH_MAX_TOOL_CALLS,
      max_output_tokens: ACCOUNT_RESEARCH_MAX_OUTPUT_TOKENS,
      reasoning: { effort: 'low' },
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: 'account_research_result',
          strict: true,
          schema: ACCOUNT_RESEARCH_JSON_SCHEMA,
        },
      },
      include: ['web_search_call.action.sources'],
      metadata: { pilot_id: pilotId, research_job_id: jobId, wholesale_account_id: input.wholesaleAccountId },
    }),
  }, fetchImpl, env, mode);
  if (!response.id) throw new Error('OpenAI did not return a response ID.');
  return { responseId: response.id, status: response.status ?? 'queued' };
}

const extractOutputText = (response: OpenAIResponse) => response.output
  ?.flatMap((item) => item.content ?? [])
  .find((content) => content.type === 'output_text' && content.text)?.text ?? null;

export async function retrieveAccountResearch({
  responseId,
  fetchImpl,
  env,
  mode = 'manual',
}: {
  responseId: string;
  fetchImpl?: ResearchFetch;
  env?: NodeJS.ProcessEnv;
  mode?: AccountResearchExecutionMode;
}): Promise<RetrievedResearchResponse> {
  const response = await requestOpenAI(`/responses/${encodeURIComponent(responseId)}`, { method: 'GET' }, fetchImpl, env, mode);
  const status = response.status ?? 'failed';
  const outputText = status === 'completed' ? extractOutputText(response) : null;
  let result = null;
  let parseError: string | null = null;
  if (outputText) {
    try {
      result = parseAccountResearchResult(JSON.parse(outputText));
    } catch (error) {
      parseError = `Structured output validation failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  } else if (status === 'completed') {
    parseError = 'The completed response did not contain structured output.';
  }
  const webSearchItems = (response.output ?? []).filter((item) => item.type === 'web_search_call');
  const sourceUrls = [...new Set(webSearchItems.flatMap((item) => item.action?.sources ?? []).map((source) => source.url).filter((url): url is string => Boolean(url)))];
  return {
    responseId,
    status,
    result,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    webSearchCalls: webSearchItems.length,
    sourceUrls,
    error: parseError || response.error?.message || response.incomplete_details?.reason || null,
  };
}
