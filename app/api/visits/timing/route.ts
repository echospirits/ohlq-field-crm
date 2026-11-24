import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '../../../../lib/auth';
import { isSampledVisitTimingId, visitTimingMaxMs } from '../../../../lib/visitTiming';

const duration = z.number().int().min(0).max(visitTimingMaxMs);
const measurement = z.object({
  id: z.string().refine(isSampledVisitTimingId),
  action: z.enum(['form', 'search', 'save']),
  outcome: z.enum(['success', 'failed', 'retry', 'cancelled']),
  elapsedMs: duration,
  responseMs: duration.optional(),
  navigation: z.enum(['document', 'route', 'restored']).optional(),
}).strict().refine(value => value.responseMs === undefined || value.responseMs <= value.elapsedMs);

const maxBytes = 512;

export async function POST(request: NextRequest) {
  const length = Number(request.headers.get('content-length'));
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  // Browser-provided Fetch Metadata reflects the public origin even when Next
  // normalizes the routing URL to a different host behind a proxy.
  if (!origin || (fetchSite ? fetchSite !== 'same-origin' : origin !== request.nextUrl.origin)) {
    return new Response(null, { status: 403 });
  }
  if (request.headers.get('content-type') !== 'application/json' || !Number.isInteger(length) || length <= 0 || length > maxBytes) {
    return new Response(null, { status: 400 });
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return new Response(null, { status: 400 }); }
  const result = measurement.safeParse(body);
  if (!result.success) return new Response(null, { status: 400 });
  if (!(await getCurrentUser())) return new Response(null, { status: 401 });

  console.info(JSON.stringify({ event: 'visit.timing.browser', ...result.data }));
  return new Response(null, { status: 204 });
}
