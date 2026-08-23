export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { buildPageMetadata } from '../../lib/appBrand';
import { getUserDisplayName, requireAdminSession } from '../../lib/auth';
import { hashPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';
import { createUserInvitationToken, sendUserInvitationEmail } from '../../lib/userInvitations';
import { PageHeader, SectionHeading } from '../components/PageChrome';

export const metadata = buildPageMetadata('Users');

const toOptional = (value: FormDataEntryValue | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toRole = (value: FormDataEntryValue | null | undefined) => {
  const role = String(value ?? '');

  if (role === UserRole.ADMIN) return UserRole.ADMIN;
  if (role === UserRole.TASTER) return UserRole.TASTER;
  return UserRole.USER;
};

const roleLabels: Record<UserRole, string> = {
  [UserRole.ADMIN]: 'Admin',
  [UserRole.TASTER]: 'Taster',
  [UserRole.USER]: 'User',
};

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
  const role = toRole(formData.get('role'));

  if (!email || !firstName || !lastName) {
    redirect('/users?status=invalid');
  }

  const name = [firstName, lastName].filter(Boolean).join(' ');
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser?.id === adminSession.user.id && role !== UserRole.ADMIN) {
    redirect('/users?status=self-role');
  }

  if (existingUser && role !== UserRole.ADMIN && !(await canRemoveAdminAccess(existingUser.id))) {
    redirect('/users?status=last-admin');
  }

  const invitationToken = createUserInvitationToken();
  const { invitation, user } = await prisma.$transaction(async (tx) => {
    const user = existingUser
      ? await tx.user.update({
          where: { id: existingUser.id },
          data: {
            firstName,
            lastName,
            name,
            phone,
            role,
          },
        })
      : await tx.user.create({
          data: {
            email,
            firstName,
            lastName,
            name,
            phone,
            passwordHash: null,
            role,
            isActive: false,
          },
        });
    const invitation = await tx.userInvitation.create({
      data: {
        userId: user.id,
        tokenHash: invitationToken.tokenHash,
        expiresAt: invitationToken.expiresAt,
      },
    });

    return { invitation, user };
  });

  let providerMessageId: string | undefined;

  try {
    const result = await sendUserInvitationEmail({
      invitationId: invitation.id,
      recipientEmail: user.email,
      recipientName: getUserDisplayName(user),
      token: invitationToken.token,
    });
    providerMessageId = result.providerMessageId;
  } catch (error) {
    console.error('[users/invite] invitation email failed', {
      invitationId: invitation.id,
      message: error instanceof Error ? error.message : String(error),
      userId: user.id,
    });
    await prisma.userInvitation.deleteMany({ where: { id: invitation.id } });

    if (!existingUser) {
      await prisma.user.deleteMany({
        where: {
          id: user.id,
          passwordHash: null,
        },
      });
    }

    redirect('/users?status=invite-email-failed');
  }

  try {
    await prisma.$transaction([
      prisma.userInvitation.update({
        where: { id: invitation.id },
        data: { providerMessageId },
      }),
      prisma.userInvitation.deleteMany({
        where: {
          userId: user.id,
          id: { not: invitation.id },
          acceptedAt: null,
        },
      }),
    ]);
  } catch (error) {
    console.error('[users/invite] invitation bookkeeping failed after email delivery', {
      invitationId: invitation.id,
      message: error instanceof Error ? error.message : String(error),
      userId: user.id,
    });
  }

  revalidatePath('/users');
  redirect(`/users?status=${existingUser ? 'invitation-resent' : 'invited'}`);
}

async function sendActivationReminder(formData: FormData) {
  'use server';

  await requireAdminSession();
  const userId = toOptional(formData.get('userId'));

  if (!userId) {
    redirect('/users?status=invalid-user');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      firstName: true,
      id: true,
      isActive: true,
      lastName: true,
      name: true,
      passwordHash: true,
    },
  });

  if (!user) {
    redirect('/users?status=invalid-user');
  }

  if (user.isActive || user.passwordHash) {
    redirect('/users?status=activation-complete');
  }

  const invitationToken = createUserInvitationToken();
  const invitation = await prisma.userInvitation.create({
    data: {
      userId: user.id,
      tokenHash: invitationToken.tokenHash,
      expiresAt: invitationToken.expiresAt,
    },
  });

  let providerMessageId: string | undefined;

  try {
    const result = await sendUserInvitationEmail({
      invitationId: invitation.id,
      isReminder: true,
      recipientEmail: user.email,
      recipientName: getUserDisplayName(user),
      token: invitationToken.token,
    });
    providerMessageId = result.providerMessageId;
  } catch (error) {
    console.error('[users/reminder] activation reminder email failed', {
      invitationId: invitation.id,
      message: error instanceof Error ? error.message : String(error),
      userId: user.id,
    });
    await prisma.userInvitation.deleteMany({ where: { id: invitation.id } });
    redirect('/users?status=reminder-email-failed');
  }

  try {
    await prisma.$transaction([
      prisma.userInvitation.update({
        where: { id: invitation.id },
        data: { providerMessageId },
      }),
      prisma.userInvitation.deleteMany({
        where: {
          userId: user.id,
          id: { not: invitation.id },
          acceptedAt: null,
        },
      }),
    ]);
  } catch (error) {
    console.error('[users/reminder] reminder bookkeeping failed after email delivery', {
      invitationId: invitation.id,
      message: error instanceof Error ? error.message : String(error),
      userId: user.id,
    });
  }

  revalidatePath('/users');
  redirect('/users?status=activation-reminder-sent');
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
  invited: 'Invitation email sent. The user can now create their password.',
  'invitation-resent': 'A new invitation email was sent to the existing user.',
  'activation-reminder-sent': 'Activation reminder sent with a new password setup link.',
  'activation-complete': 'That user has already completed activation.',
  'invite-email-failed': 'The user was not invited because the email could not be sent. Try again.',
  'reminder-email-failed': 'The activation reminder could not be sent. Try again.',
  invalid: 'Email, first name, and last name are required.',
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
    include: {
      invitations: {
        where: {
          acceptedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: [{ role: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }, { email: 'asc' }],
  });
  const now = new Date();

  return (
    <>
      <PageHeader
        description="Invite teammates, manage access levels, and keep inactive accounts out of field workflows."
        eyebrow="Administration"
        title="Users"
      />
      {params.status ? <p className="toast-notice page-status">{statusMessages[params.status] ?? params.status}</p> : null}

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
              Permission
              <select name="role" defaultValue={UserRole.USER}>
                <option value={UserRole.USER}>User</option>
                <option value={UserRole.TASTER}>Taster</option>
                <option value={UserRole.ADMIN}>Admin</option>
              </select>
            </label>
          </div>
          <button type="submit">Invite user</button>
        </form>
      </details>

      <section className="content-section">
      <SectionHeading
        count={users.length}
        description={`${users.filter((user) => user.isActive).length} active · ${users.filter((user) => !user.isActive && !user.passwordHash).length} awaiting activation`}
        title="Team access"
      />
      <div className="table-scroll"><table className="responsive-table">
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
          {users.map((user) => {
            const invitation = user.invitations[0];
            const isAwaitingActivation = !user.isActive && !user.passwordHash;
            const hasCurrentInvitation = Boolean(invitation && invitation.expiresAt > now);

            return (
              <tr key={user.id}>
              <td data-label="Name">{getUserDisplayName(user)}</td>
              <td data-label="Email">{user.email}</td>
              <td data-label="Phone">{user.phone}</td>
              <td data-label="Permission">{roleLabels[user.role]}</td>
              <td data-label="Status">
                {isAwaitingActivation
                  ? hasCurrentInvitation
                    ? 'Pending activation'
                    : 'Activation link expired'
                  : hasCurrentInvitation
                    ? 'Active · invitation pending'
                  : user.isActive
                    ? 'Active'
                    : 'Inactive'}
              </td>
              <td data-label="Admin controls">
                <div className="user-admin-actions">
                  {isAwaitingActivation ? (
                    <form action={sendActivationReminder} className="inline-control-form">
                      <input name="userId" type="hidden" value={user.id} />
                      <button className="compact-btn secondary" type="submit">
                        Send reminder
                      </button>
                    </form>
                  ) : null}

                  <form action={updateUserRole} className="inline-control-form">
                    <input name="userId" type="hidden" value={user.id} />
                    <select aria-label={`Permission for ${getUserDisplayName(user)}`} name="role" defaultValue={user.role}>
                      <option value={UserRole.USER}>User</option>
                      <option value={UserRole.TASTER}>Taster</option>
                      <option value={UserRole.ADMIN}>Admin</option>
                    </select>
                    <button className="compact-btn secondary" type="submit">
                      Save role
                    </button>
                  </form>

                  {!isAwaitingActivation ? (
                    <form action={toggleUserStatus} className="inline-control-form">
                      <input name="userId" type="hidden" value={user.id} />
                      <input name="activate" type="hidden" value={user.isActive ? 'false' : 'true'} />
                      <button className={user.isActive ? 'compact-btn danger-btn' : 'compact-btn secondary'} type="submit">
                        {user.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </form>
                  ) : null}

                  {!isAwaitingActivation ? (
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
                  ) : null}
                </div>
              </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      </section>
    </>
  );
}
