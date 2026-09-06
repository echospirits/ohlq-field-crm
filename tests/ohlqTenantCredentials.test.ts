import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { getOrganizationOhlqCredentials, maskOhlqUsername, saveOrganizationOhlqCredentials } from '../lib/ohlqTenantCredentials';

const originalKey = process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY = originalKey;
});

describe('tenant OHLQ credentials', () => {
  it('encrypts credentials at rest and decrypts them only for the matching organization lookup', async () => {
    process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY = 'test-only-key-with-more-than-thirty-two-characters';
    let stored: Record<string, string> | null = null;
    const db = {
      organizationOhlqCredentials: {
        findUnique: async ({ where }: { where: { organizationId: string } }) => where.organizationId === 'org-1' ? stored : null,
        upsert: async ({ create }: { create: Record<string, string> }) => { stored = create; return create; },
      },
    } as unknown as PrismaClient;

    await saveOrganizationOhlqCredentials({ db, organizationId: 'org-1', password: 'private-password', updatedByUserId: 'user-1', username: 'tenant@example.com' });
    assert.ok(stored);
    const saved = stored as Record<string, string>;
    assert.notEqual(saved.usernameEncrypted, 'tenant@example.com');
    assert.notEqual(saved.passwordEncrypted, 'private-password');
    assert.equal(saved.usernameHint, 'te***@example.com');
    assert.deepEqual(await getOrganizationOhlqCredentials('org-1', db), { password: 'private-password', username: 'tenant@example.com' });
    assert.equal(await getOrganizationOhlqCredentials('org-2', db), null);
  });

  it('requires a dedicated strong encryption key', async () => {
    process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY = 'short';
    const db = { organizationOhlqCredentials: { upsert: async () => ({}) } } as unknown as PrismaClient;
    await assert.rejects(saveOrganizationOhlqCredentials({ db, organizationId: 'org-1', password: 'secret', updatedByUserId: 'user-1', username: 'tenant' }), /at least 32 characters/);
    assert.equal(maskOhlqUsername('tenant'), 'te***');
  });
});
