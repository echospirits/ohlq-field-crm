import { randomUUID } from 'node:crypto';

type VisitContext = {
  userId?: string;
  organizationId?: string;
  visitId?: string;
  locationType?: string;
  committed?: boolean;
};

// Deliberately exclude form contents, URLs, cookies and Prisma error messages
// (which can contain submitted values). Stack frames retain the code location.
function errorDetails(error: unknown) {
  if (!(error instanceof Error)) return { name: 'UnknownError' };
  const code = 'code' in error ? String(error.code) : undefined;
  return {
    name: error.name,
    code: code && /^P\d{4}$/.test(code) ? code : undefined,
    stack: error.stack?.split('\n').filter(line => /^\s+at /.test(line)).slice(0, 12).join('\n'),
  };
}

export function createVisitDiagnostics(operation: 'create' | 'update') {
  const startedAt = Date.now();
  const operationId = randomUUID();
  let stage = 'start';
  let context: VisitContext = { committed: false };
  const emit = (event: string, error?: unknown) => {
    const memory = process.memoryUsage();
    const record = JSON.stringify({
      event: `visit.${event}`, operation, operationId, stage,
      timestamp: new Date().toISOString(), elapsedMs: Date.now() - startedAt,
      deployment: process.env.VERCEL_DEPLOYMENT_ID,
      revision: process.env.VERCEL_GIT_COMMIT_SHA,
      rssBytes: memory.rss, heapUsedBytes: memory.heapUsed,
      ...context, ...(error === undefined ? {} : { error: errorDetails(error) }),
    });
    if (error === undefined) console.info(record);
    else console.error(record);
  };
  return {
    mark(nextStage: string, values: VisitContext = {}) {
      stage = nextStage;
      context = { ...context, ...values };
      emit('stage');
    },
    failure(error: unknown) { emit('failed', error); },
    async bestEffort(nextStage: string, work: () => Promise<unknown>) {
      stage = nextStage;
      emit('stage');
      try { await work(); }
      catch (error) { emit('follow_up_failed', error); }
    },
  };
}

export type VisitDiagnostics = ReturnType<typeof createVisitDiagnostics>;
