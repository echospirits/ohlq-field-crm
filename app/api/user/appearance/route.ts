import { getCurrentUser } from '../../../../lib/auth';
import { prisma } from '../../../../lib/prisma';
import { parseDarkModePreference, saveUserAppearance } from '../../../../lib/userAppearance';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Sign in to view your preferences.' }, { status: 401, headers });
  return Response.json({ darkMode: user.darkMode }, { headers });
}

export async function PUT(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return Response.json({ error: 'Please save from Neat.' }, { status: 403, headers });
  }
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Sign in to save your preferences.' }, { status: 401, headers });
  let darkMode: boolean;
  try {
    darkMode = parseDarkModePreference(await request.json());
  } catch {
    return Response.json({ error: 'Choose whether Dark mode is on or off.' }, { status: 400, headers });
  }
  try {
    const preference = await saveUserAppearance(prisma, user.id, darkMode);
    revalidatePath('/', 'layout');
    return Response.json(preference, { headers });
  } catch {
    return Response.json({ error: 'Could not save Dark mode. Please try again.' }, { status: 500, headers });
  }
}
