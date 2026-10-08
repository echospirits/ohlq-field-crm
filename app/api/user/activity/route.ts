import { getCurrentUser } from '../../../../lib/auth';
import { prisma } from '../../../../lib/prisma';
import { recordUserActivity } from '../../../../lib/userActivity';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return Response.json({ error: 'Please use Neat to record activity.' }, { status: 403, headers });
  }
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Sign in to record activity.' }, { status: 401, headers });
  try {
    const day = await recordUserActivity(prisma, user);
    return Response.json({ day }, { headers });
  } catch (error) {
    console.error('[user-activity] Could not record daily usage', error);
    return Response.json({ error: 'Could not record usage.' }, { status: 503, headers });
  }
}
