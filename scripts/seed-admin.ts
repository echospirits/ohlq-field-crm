import { UserRole } from '@prisma/client';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';

const email = process.env.SEED_ADMIN_EMAIL ?? 'joe@echospirits.com';
const firstName = process.env.SEED_ADMIN_FIRST_NAME ?? 'Joe';
const lastName = process.env.SEED_ADMIN_LAST_NAME ?? 'Bidinger';
const phone = process.env.SEED_ADMIN_PHONE ?? '614-329-0235';
const password = process.env.SEED_ADMIN_PASSWORD;

async function main() {
  if (!password) {
    throw new Error('SEED_ADMIN_PASSWORD is required.');
  }

  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      firstName,
      lastName,
      name: [firstName, lastName].filter(Boolean).join(' '),
      phone,
      passwordHash: hashPassword(password),
      role: UserRole.ADMIN,
      isActive: true,
    },
    update: {
      firstName,
      lastName,
      name: [firstName, lastName].filter(Boolean).join(' '),
      phone,
      passwordHash: hashPassword(password),
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
