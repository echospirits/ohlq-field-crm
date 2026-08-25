import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { getAppEnvironment, getSafeDatabaseTarget } from '../../../lib/appEnvironment';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await prisma.$queryRaw`select 1`;
    return NextResponse.json({ ok: true, database: 'connected', databaseTarget: getSafeDatabaseTarget(), environment: getAppEnvironment() });
  } catch (error) {
    return NextResponse.json({ ok: false, database: 'error', databaseTarget: getSafeDatabaseTarget(), environment: getAppEnvironment() }, { status: 500 });
  }
}
