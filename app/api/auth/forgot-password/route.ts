import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createPasswordResetToken, PASSWORD_RESET_COOLDOWN_MS, sendPasswordResetEmail } from '../../../../lib/passwordReset';
import { prisma } from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const requestSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
});

const GENERIC_RESPONSE = {
  message: 'If an active account uses that email, a password reset link will arrive shortly.',
};

export async function POST(request: NextRequest) {
  let parsed: z.infer<typeof requestSchema>;

  try {
    parsed = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ message: 'Enter a valid email address.' }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: parsed.email },
      select: { id: true, isActive: true, passwordHash: true },
    });

    if (user?.isActive && user.passwordHash) {
      const now = new Date();
      const recentRequest = await prisma.passwordResetToken.findFirst({
        where: {
          userId: user.id,
          createdAt: { gt: new Date(now.getTime() - PASSWORD_RESET_COOLDOWN_MS) },
        },
        select: { id: true },
      });

      if (!recentRequest) {
        const token = createPasswordResetToken(now);
        const resetRequest = await prisma.$transaction(async (tx) => {
          const record = await tx.passwordResetToken.create({
            data: {
              userId: user.id,
              tokenHash: token.tokenHash,
              expiresAt: token.expiresAt,
            },
          });

          await tx.passwordResetToken.updateMany({
            where: { userId: user.id, id: { not: record.id }, usedAt: null },
            data: { usedAt: now },
          });

          return record;
        });

        try {
          await sendPasswordResetEmail({
            recipientEmail: parsed.email,
            resetRequestId: resetRequest.id,
            token: token.token,
          });
        } catch {
          await prisma.passwordResetToken.deleteMany({ where: { id: resetRequest.id } });
          console.error('Password reset email delivery failed.');
        }
      }
    }
  } catch {
    console.error('Password reset request could not be completed.');
  }

  return NextResponse.json(GENERIC_RESPONSE, { status: 202 });
}
