export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getUserDisplayName, requireUserSession } from '../../lib/auth';
import { hashPassword, verifyPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';

const toOptional = (value: FormDataEntryValue | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

async function updateProfile(formData: FormData) {
  'use server';

  const session = await requireUserSession();
  const user = session.user;
  const phone = toOptional(formData.get('phone'));
  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');
  const data: { phone: string | null; passwordHash?: string } = { phone };

  if (newPassword || confirmPassword || currentPassword) {
    if (!newPassword || newPassword !== confirmPassword) {
      redirect('/profile?status=password-mismatch');
    }

    if (newPassword.length < 10) {
      redirect('/profile?status=password-too-short');
    }

    if (!verifyPassword(currentPassword, user.passwordHash)) {
      redirect('/profile?status=current-password-invalid');
    }

    data.passwordHash = hashPassword(newPassword);
    await prisma.userSession.deleteMany({
      where: {
        userId: user.id,
        tokenHash: { not: session.tokenHash },
      },
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data,
  });

  revalidatePath('/profile');
  revalidatePath('/');
  redirect('/profile?status=updated');
}

const statusMessages: Record<string, string> = {
  updated: 'Profile updated.',
  'password-mismatch': 'New password and confirmation must match.',
  'password-too-short': 'New password must be at least 10 characters.',
  'current-password-invalid': 'Current password is incorrect.',
};

export default async function ProfilePage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const { user } = await requireUserSession();
  const params = (await searchParams) ?? {};

  return (
    <>
      <h1>Profile</h1>
      <p className="muted">Manage your phone number and password.</p>
      {params.status ? <p className="pill">{statusMessages[params.status] ?? params.status}</p> : null}

      <div className="card admin-panel">
        <form action={updateProfile}>
          <div className="form-grid">
            <label>
              Name
              <input value={getUserDisplayName(user)} readOnly />
            </label>
            <label>
              Email
              <input value={user.email} readOnly />
            </label>
            <label>
              Phone
              <input autoComplete="tel" name="phone" defaultValue={user.phone ?? ''} />
            </label>
          </div>
          <details className="compact-details nested-details">
            <summary>Change password</summary>
            <div className="form-grid">
              <label>
                Current password
                <input autoComplete="current-password" name="currentPassword" type="password" />
              </label>
              <label>
                New password
                <input autoComplete="new-password" minLength={10} name="newPassword" type="password" />
              </label>
              <label>
                Confirm new password
                <input autoComplete="new-password" minLength={10} name="confirmPassword" type="password" />
              </label>
            </div>
          </details>
          <button type="submit">Save profile</button>
        </form>
      </div>
    </>
  );
}
