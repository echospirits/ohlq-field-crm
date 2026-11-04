// Server-only: node:crypto and database access must never enter client bundles.
import { createCipheriv, createDecipheriv, createHash, randomBytes, type CipherKey } from 'node:crypto';
import { z } from 'zod';
import { type Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../prisma';
import { maskOhlqUsername } from '../../ohlqTenantCredentials';
import { forecastAccess } from '../import';
import type { OpenDockLocationConfig } from './types';

type Db = PrismaClient | Prisma.TransactionClient;
const provider = z.literal('OPENDOCK');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value);
const timezone = z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; } });
const calendar = z.object({ coveredFrom: day, coveredThrough: day, openWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7), closedDates: z.array(day).max(1000) }).strict().refine(value => value.coveredFrom <= value.coveredThrough && new Set(value.openWeekdays).size === value.openWeekdays.length && value.closedDates.every(date => date >= value.coveredFrom && date <= value.coveredThrough));
const location = z.object({ market: z.literal('OH'), locationCode: z.enum(['GPT', 'GRN']), locationName: z.string().trim().min(1).max(160), warehouseId: z.string().uuid(), loadTypeId: z.string().uuid(), timezone, calendar: calendar.optional() }).strict();
const configuration = z.object({ verifiedAt: z.string().datetime({ offset: true }), locations: z.array(location).length(2) }).strict().refine(value => new Set(value.locations.map(item => item.locationCode)).size === 2 && new Set(value.locations.map(item => item.warehouseId)).size === 2);

/** IDs and delivery types must be verified in the authorized booking workflow. */
export function openDockConfiguration(settings: unknown): { configured: boolean; locations: OpenDockLocationConfig[]; issue: string | null } {
  const raw = (settings as { productionForecasting?: { operationalSignals?: { opendock?: unknown } } } | null)?.productionForecasting?.operationalSignals?.opendock;
  if (!raw) return { configured: false, locations: [], issue: 'OpenDock warehouse and delivery-type mappings have not been verified.' };
  const parsed = configuration.safeParse(raw);
  if (!parsed.success) return { configured: false, locations: [], issue: 'OpenDock configuration is incomplete or invalid. Verify GPT and GRN warehouse IDs, delivery types and timezones.' };
  return { configured: true, locations: parsed.data.locations, issue: null };
}

export async function requireOperationalSignalOrganization(organizationId: string, db: Db) {
  const organization = await forecastAccess(db, organizationId);
  if (!organization.enabledStates.includes('OH')) throw new Error('Ohio operational signals are unavailable for this organization.');
  return organization;
}

export function operationalCredentialKeyStatus(): { configured: boolean; keyVariable: 'PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY' | 'OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY' } {
  const keyVariable = process.env.PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY !== undefined
    ? 'PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY'
    : 'OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY';
  const value = process.env[keyVariable]?.trim();
  return { configured: Boolean(value && value.length >= 32), keyVariable };
}

function encryptionKey() {
  // The same selector powers setup readiness and encryption, including fail-closed
  // handling when a dedicated variable is present but malformed.
  const status = operationalCredentialKeyStatus();
  if (!status.configured) {
    if (status.keyVariable === 'PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY') throw new Error('PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY must contain at least 32 characters.');
    throw new Error('Configure PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY (at least 32 characters) or the existing OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY.');
  }
  return createHash('sha256').update(process.env[status.keyVariable]!.trim()).digest();
}
const aad = (organizationId: string, source: string, field: string) => Buffer.from(JSON.stringify(['operational-credential-v1', organizationId, source, field]));
function encrypt(value: string, organizationId: string, source: string, field: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey() as unknown as CipherKey, iv as unknown as NodeJS.ArrayBufferView);
  cipher.setAAD(aad(organizationId, source, field) as unknown as NodeJS.ArrayBufferView);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()] as unknown as Uint8Array[]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
function decrypt(encoded: string, organizationId: string, source: string, field: string) {
  const parts = encoded.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1' || parts.slice(1).some(value => !/^[A-Za-z0-9_-]+$/.test(value))) throw new Error('Operational credentials could not be decrypted. Reconfigure this connection.');
  const [, iv, tag, value] = parts;
  try {
    if (Buffer.from(iv, 'base64url').length !== 12 || Buffer.from(tag, 'base64url').length !== 16) throw new Error('Invalid encoding.');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey() as unknown as CipherKey, Buffer.from(iv, 'base64url') as unknown as NodeJS.ArrayBufferView);
    decipher.setAAD(aad(organizationId, source, field) as unknown as NodeJS.ArrayBufferView);
    decipher.setAuthTag(Buffer.from(tag, 'base64url') as unknown as NodeJS.ArrayBufferView);
    return Buffer.concat([decipher.update(Buffer.from(value, 'base64url') as unknown as NodeJS.ArrayBufferView), decipher.final()] as unknown as Uint8Array[]).toString('utf8');
  } catch { throw new Error('Operational credentials could not be decrypted. Reconfigure this connection.'); }
}

export async function saveOrganizationOperationalCredentials({ organizationId, provider: source, username, password, updatedByUserId = null, db = prisma }: { organizationId: string; provider: 'OPENDOCK'; username: string; password: string; updatedByUserId?: string | null; db?: Db }) {
  provider.parse(source);
  await requireOperationalSignalOrganization(organizationId, db);
  const input = z.object({ username: z.string().trim().email().max(320), password: z.string().min(1).max(2048) }).parse({ username, password });
  const data = { usernameEncrypted: encrypt(input.username, organizationId, source, 'username'), passwordEncrypted: encrypt(input.password, organizationId, source, 'password'), usernameHint: maskOhlqUsername(input.username), configuredAt: new Date(), updatedByUserId };
  const saved = await db.organizationOperationalCredential.upsert({ where: { organizationId_provider: { organizationId, provider: source } }, create: { organizationId, provider: source, ...data }, update: data, select: { configuredAt: true, usernameHint: true } });
  return { configured: true, ...saved };
}

export async function getOrganizationOperationalCredentials(organizationId: string, source: 'OPENDOCK' = 'OPENDOCK', db: Db = prisma) {
  provider.parse(source);
  await requireOperationalSignalOrganization(organizationId, db);
  const stored = await db.organizationOperationalCredential.findUnique({ where: { organizationId_provider: { organizationId, provider: source } }, select: { usernameEncrypted: true, passwordEncrypted: true } });
  if (!stored) return null;
  return { email: decrypt(stored.usernameEncrypted, organizationId, source, 'username'), password: decrypt(stored.passwordEncrypted, organizationId, source, 'password') };
}

export async function getOperationalSignalConfiguration(organizationId: string, db: Db = prisma) {
  const organization = await requireOperationalSignalOrganization(organizationId, db);
  const stored = await db.organizationOperationalCredential.findUnique({ where: { organizationId_provider: { organizationId, provider: 'OPENDOCK' } }, select: { configuredAt: true, usernameHint: true } });
  return { opendock: { ...openDockConfiguration(organization.settings), encryption: operationalCredentialKeyStatus(), credentials: stored ? { configured: true, configuredAt: stored.configuredAt.toISOString(), usernameHint: stored.usernameHint } : { configured: false, configuredAt: null, usernameHint: null } } };
}
