export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getCurrentSession, getUserDisplayName, SESSION_COOKIE } from '../../../../lib/auth';
import {
  structureVisitTranscript,
  VoiceVisitNoteRequestSchema,
  VoiceVisitNoteResponseSchema,
} from '../../../../lib/voiceVisitNote';

const unauthorized = () => NextResponse.json({ error: 'Sign in before structuring a visit note.' }, { status: 401 });

export async function POST(request: Request) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const hasSessionCookie = cookieHeader.split(';').some((cookie) => cookie.trim().startsWith(`${SESSION_COOKIE}=`));

  if (!hasSessionCookie) {
    return unauthorized();
  }

  const session = await getCurrentSession();

  if (!session) {
    return unauthorized();
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Send transcript text to structure a visit note.' }, { status: 400 });
  }

  const parsed = VoiceVisitNoteRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid visit note transcript.' }, { status: 400 });
  }

  const structured = structureVisitTranscript({
    transcript: parsed.data.transcript,
    visitType: parsed.data.visitType,
    accountName: parsed.data.accountContext?.name ?? null,
    actorName: getUserDisplayName(session.user),
    timezone: parsed.data.timezone ?? 'America/New_York',
  });
  const validated = VoiceVisitNoteResponseSchema.safeParse(structured);

  if (!validated.success) {
    return NextResponse.json({ error: 'The visit note could not be structured safely.' }, { status: 422 });
  }

  return NextResponse.json(validated.data);
}
