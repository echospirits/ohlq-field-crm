'use server';

import { redirect } from 'next/navigation';
import { hashPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';
import { hashUserInvitationToken } from '../../lib/userInvitations';

const redirectToInvite = (token: string, status: string): never => {
  const params = new URLSearchParams({ token, status });
  redirect(`/accept-invite?${params.toString()}`);
};

export async function acceptUserInvitation(formData: FormData) {
  const token = String(formData.get('token') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (!token) {
    redirect('/accept-invite?status=invalid');
  }

  if (!password || password !== confirmPassword) {
    redirectToInvite(token, 'password-mismatch');
  }

  if (password.length < 10) {
    redirectToInvite(token, 'password-too-short');
  }

  const tokenHash = hashUserInvitationToken(token);
  const invitation = await prisma.userInvitation.findFirst({
    where: {
      tokenHash,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      userId: true,
      user: { select: { organizationId: true } },
    },
  });

  if (!invitation) {
    redirect('/accept-invite?status=invalid');
  }

  const passwordHash = hashPassword(password);
  const organizationId = invitation.user.organizationId;
  const organization = organizationId ? await prisma.organization.findUnique({ where: { id: organizationId }, select: { onboardingData: true } }) : null;
  const onboarding = organization?.onboardingData && typeof organization.onboardingData === 'object' && !Array.isArray(organization.onboardingData) ? organization.onboardingData as Record<string, unknown> : {};
  const accepted = await prisma.$transaction(async (tx) => {
    const claim = await tx.userInvitation.updateMany({
      where: {
        id: invitation.id,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        acceptedAt: new Date(),
      },
    });

    if (claim.count !== 1) {
      return false;
    }

    await tx.user.update({
      where: { id: invitation.userId },
      data: {
        isActive: true,
        passwordHash,
      },
    });
    await tx.userSession.deleteMany({ where: { userId: invitation.userId } });
    await tx.userInvitation.deleteMany({
      where: {
        userId: invitation.userId,
        id: { not: invitation.id },
        acceptedAt: null,
      },
    });
    if (organizationId) {
      await tx.organization.update({ where: { id: organizationId }, data: { onboardingData: { ...onboarding, firstLogin: true } } });
    }

    return true;
  });

  if (!accepted) {
    redirect('/accept-invite?status=invalid');
  }

  redirect('/login?status=invite-accepted');
}
