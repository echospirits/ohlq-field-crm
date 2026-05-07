export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getUserDisplayName, requireAdminSession } from '../../lib/auth';
import { hashPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';

const toOptional = (value: FormDataEntryValue | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toRole = (value: FormDataEntryValue | null | undefined) =>
  String(value ?? '') === UserRole.ADMIN ? UserRole.ADMIN : UserRole.USER;

const getActiveAdminCount = () =>
  prisma.user.count({
    where: {
      isActive: true,
      role: UserRole.ADMIN,
    },
  });

const canRemoveAdminAccess = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isActive: true,
      role: true,
    },
  });

  if (!user || user.role !== UserRole.ADMIN || !user.isActive) {
    return true;
  }

  return (await getActiveAdminCount()) > 1;
};

async function inviteUser(formData: FormData) {
  'use server';

  const adminSession = await requireAdminSession();

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const firstName = toOptional(formData.get('firstName'));
  const lastName = toOptional(formData.get('lastName'));
  const phone = toOptional(formData.get('phone'));
  const password = String(formData.get('password') ?? '');
  const role = toRole(formData.get('role'));

  if (!email || !firstName || !lastName || !password) {
    redirect('/users?status=invalid');
  }

  if (password.length < 10) {
    redirect('/users?status=password-too-short');
  }

  const name = [firstName, lastName].filter(Boolean).join(' ');
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        firstName,
        lastName,
        name,
        phone,
        passwordHash: hashPassword(password),
        role,
        isActive: true,
      },
    });

    await prisma.userSession.deleteMany({
      where: {
        userId: existingUser.id,
        tokenHash: existingUser.id === adminSession.user.id ? { not: adminSession.tokenHash } : undefined,
      },
    });
    revalidatePath('/users');
    redirect('/users?status=updated-existing');
  }

  await prisma.user.create({
    data: {
      email,
      firstName,
      lastName,
      name,
      phone,
      passwordHash: hashPassword(password),
      role,
      isActive: true,
    },
  });

  revalidatePath('/users');
  redirect('/users?status=invited');
}

async function updateUserRole(formData: FormData) {
  'use server';

  const adminSession = await requireAdminSession();
  const userId = toOptional(formData.get('userId'));
  const role = toRole(formData.get('role'));

  if (!userId) {
    redirect('/users?status=invalid-user');
  }

  if (userId === adminSession.user.id && role !== UserRole.ADMIN) {
    redirect('/users?status=self-role');
  }

  if (role !== UserRole.ADMIN && !(await canRemoveAdminAccess(userId))) {
    redirect('/users?status=last-admin');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { role },
  });

  revalidatePath('/users');
  redirect('/users?status=role-updated');
}

async function toggleUserStatus(formData: FormData) {
  'use server';

  const adminSession = await requireAdminSession();
  const userId = toOptional(formData.get('userId'));
  const activate = String(formData.get('activate') ?? '') === 'true';

  if (!userId) {
    redirect('/users?status=invalid-user');
  }

  if (userId === adminSession.user.id && !activate) {
    redirect('/users?status=self-deactivate');
  }

  if (!activate && !(await canRemoveAdminAccess(userId))) {
    redirect('/users?status=last-admin');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { isActive: activate },
  });

  if (!activate) {
    await prisma.userSession.deleteMany({ where: { userId } });
  }

  revalidatePath('/users');
  redirect(`/users?status=${activate ? 'reactivated' : 'deactivated'}`);
}

async function resetUserPassword(formData: FormData) {
  'use server';

  const adminSession = await requireAdminSession();
  const userId = toOptional(formData.get('userId'));
  const password = String(formData.get('password') ?? '');

  if (!userId) {
    redirect('/users?status=invalid-user');
  }

  if (password.length < 10) {
    redirect('/users?status=password-too-short');
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: hashPassword(password),
      isActive: true,
    },
  });

  await prisma.userSession.deleteMany({
    where: {
      userId,
      tokenHash: userId === adminSession.user.id ? { not: adminSession.tokenHash } : undefined,
    },
  });

  revalidatePath('/users');
  redirect('/users?status=password-reset');
}

const statusMessages: Record<string, string> = {
  invited: 'User invited.',
  'updated-existing': 'Existing user updated with new credentials.',
  invalid: 'Email, first name, last name, and password are required.',
  'invalid-user': 'Select a valid user.',
  'password-too-short': 'Password must be at least 10 characters.',
  'role-updated': 'User permission updated.',
  reactivated: 'User reactivated.',
  deactivated: 'User deactivated and signed out.',
  'password-reset': 'Password reset and other sessions signed out.',
  'last-admin': 'At least one active admin is required.',
  'self-deactivate': 'You cannot deactivate your own account.',
  'self-role': 'You cannot remove your own admin permission.',
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  await requireAdminSession();
  const params = (await searchParams) ?? {};
  const users = await prisma.user.findMany({
    orderBy: [{ role: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }, { email: 'asc' }],
  });

  return (
    <>
      <h1>Users</h1>
      <p className="muted">Only admins can invite user accounts.</p>
      {params.status ? <p className="pill">{statusMessages[params.status] ?? params.status}</p> : null}

      <details className="card compact-details admin-panel" open>
        <summary>Invite user</summary>
        <form action={inviteUser}>
          <div className="form-grid">
            <label>
              Email
              <input autoComplete="email" name="email" type="email" required />
            </label>
            <label>
              First name
              <input autoComplete="given-name" name="firstName" required />
            </label>
            <label>
              Last name
              <input autoComplete="family-name" name="lastName" required />
            </label>
            <label>
              Phone
              <input autoComplete="tel" name="phone" />
            </label>
            <label>
              Password
              <input autoComplete="new-password" minLength={10} name="password" type="password" required />
            </label>
            <label>
              Permission
              <select name="role" defaultValue={UserRole.USER}>
                <option value={UserRole.USER}>User</option>
                <option value={UserRole.ADMIN}>Admin</option>
              </select>
            </label>
          </div>
          <button type="submit">Invite user</button>
        </form>
      </details>

      <table className="responsive-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Permission</th>
            <th>Status</th>
            <th>Admin controls</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td data-label="Name">{getUserDisplayName(user)}</td>
              <td data-label="Email">{user.email}</td>
              <td data-label="Phone">{user.phone}</td>
              <td data-label="Permission">{user.role === UserRole.ADMIN ? 'Admin' : 'User'}</td>
              <td data-label="Status">{user.isActive ? 'Active' : 'Inactive'}</td>
              <td data-label="Admin controls">
                <div className="user-admin-actions">
                  <form action={updateUserRole} className="inline-control-form">
                    <input name="userId" type="hidden" value={user.id} />
                    <select aria-label={`Permission for ${getUserDisplayName(user)}`} name="role" defaultValue={user.role}>
                      <option value={UserRole.USER}>User</option>
                      <option value={UserRole.ADMIN}>Admin</option>
                    </select>
                    <button className="compact-btn secondary" type="submit">
                      Save role
                    </button>
                  </form>

                  <form action={toggleUserStatus} className="inline-control-form">
                    <input name="userId" type="hidden" value={user.id} />
                    <input name="activate" type="hidden" value={user.isActive ? 'false' : 'true'} />
                    <button className={user.isActive ? 'compact-btn danger-btn' : 'compact-btn secondary'} type="submit">
                      {user.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </form>

                  <details className="compact-details cardless-details user-reset-details">
                    <summary>Reset password</summary>
                    <form action={resetUserPassword} className="inline-control-form">
                      <input name="userId" type="hidden" value={user.id} />
                      <input
                        aria-label={`New password for ${getUserDisplayName(user)}`}
                        autoComplete="new-password"
                        minLength={10}
                        name="password"
                        placeholder="New password"
                        type="password"
                        required
                      />
                      <button className="compact-btn secondary" type="submit">
                        Reset
                      </button>
                    </form>
                  </details>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
