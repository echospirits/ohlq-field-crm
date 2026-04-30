import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await prisma.$queryRaw`select 1`;
    return NextResponse.json({ ok: true, database: 'connected' });
  } catch (error) {
    return NextResponse.json({ ok: false, database: 'error', message: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
