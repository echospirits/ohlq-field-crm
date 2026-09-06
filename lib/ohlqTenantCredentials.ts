import { createCipheriv, createDecipheriv, createHash, randomBytes, type CipherKey } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

const getKey = () => {
  const configured = process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!configured || configured.length < 32) {
    throw new Error('OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY must contain at least 32 characters.');
  }
  return createHash('sha256').update(configured).digest();
};

const encrypt = (plainText: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey() as unknown as CipherKey, iv as unknown as NodeJS.ArrayBufferView);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()] as unknown as Uint8Array[]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
};

const decrypt = (encoded: string) => {
  const [version, iv, tag, value] = encoded.split('.');
  if (version !== 'v1' || !iv || !tag || !value) throw new Error('Invalid encrypted OHLQ tenant credential.');
  const decipher = createDecipheriv('aes-256-gcm', getKey() as unknown as CipherKey, Buffer.from(iv, 'base64url') as unknown as NodeJS.ArrayBufferView);
  decipher.setAuthTag(Buffer.from(tag, 'base64url') as unknown as NodeJS.ArrayBufferView);
  return Buffer.concat([decipher.update(Buffer.from(value, 'base64url') as unknown as NodeJS.ArrayBufferView), decipher.final()] as unknown as Uint8Array[]).toString('utf8');
};

export const maskOhlqUsername = (username: string) => {
  const [local, domain] = username.split('@');
  if (!domain) return `${username.slice(0, 2)}***`;
  return `${local.slice(0, 2)}***@${domain}`;
};

export async function saveOrganizationOhlqCredentials({ db = prisma, organizationId, password, updatedByUserId, username }: {
  db?: PrismaClient; organizationId: string; password: string; updatedByUserId?: string | null; username: string;
}) {
  const cleanUsername = username.trim();
  if (!cleanUsername || password.length < 1) throw new Error('Both OHLQ username and password are required.');
  return db.organizationOhlqCredentials.upsert({
    where: { organizationId },
    create: { organizationId, passwordEncrypted: encrypt(password), updatedByUserId: updatedByUserId ?? null, usernameEncrypted: encrypt(cleanUsername), usernameHint: maskOhlqUsername(cleanUsername) },
    update: { configuredAt: new Date(), passwordEncrypted: encrypt(password), updatedByUserId: updatedByUserId ?? null, usernameEncrypted: encrypt(cleanUsername), usernameHint: maskOhlqUsername(cleanUsername) },
  });
}

export async function getOrganizationOhlqCredentials(organizationId: string, db: PrismaClient = prisma) {
  const stored = await db.organizationOhlqCredentials.findUnique({ where: { organizationId } });
  if (!stored) return null;
  return { password: decrypt(stored.passwordEncrypted), username: decrypt(stored.usernameEncrypted) };
}
