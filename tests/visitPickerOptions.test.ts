import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  getAgenciesForVisitPicker,
  getInitialVisitLocationType,
  getVisitPickerSuggestions,
  getWholesaleAccountsForVisitPicker,
  searchAgenciesForVisitPicker,
  searchWholesaleAccountsForVisitPicker,
  sortVisitPickerOptions,
} from '../lib/visitPickerOptions';

describe('getInitialVisitLocationType', () => {
  it('defaults direct visit logging to wholesale', () => {
    assert.equal(getInitialVisitLocationType({}), 'wholesale');
    assert.equal(getInitialVisitLocationType({ type: 'wholesale' }), 'wholesale');
  });

  it('keeps wholesale-origin visit logging on wholesale', () => {
    assert.equal(getInitialVisitLocationType({ wholesaleAccountId: 'wholesale-1' }), 'wholesale');
  });

  it('keeps agency-origin visit logging on agency', () => {
    assert.equal(getInitialVisitLocationType({ type: 'agency' }), 'agency');
    assert.equal(getInitialVisitLocationType({ agencyId: 'agency-1' }), 'agency');
  });
});

describe('sortVisitPickerOptions', () => {
  it('sorts by most recent visit first, then account name', () => {
    const items = sortVisitPickerOptions([
      { id: 'never-b', name: 'Bravo', lastVisitAt: null },
      { id: 'recent-b', name: 'Zulu', lastVisitAt: '2026-05-11T00:00:00.000Z' },
      { id: 'recent-a', name: 'Alpha', lastVisitAt: '2026-05-11T00:00:00.000Z' },
      { id: 'old', name: 'Recent Enough', lastVisitAt: '2026-04-01T00:00:00.000Z' },
      { id: 'never-a', name: 'Alpha Never', lastVisitAt: null },
    ]);

    assert.deepEqual(
      items.map((item) => item.id),
      ['recent-a', 'recent-b', 'old', 'never-a', 'never-b'],
    );
  });
});

describe('visit picker services', () => {
  it('keeps direct suggestions bounded and finds recently visited retail accounts by legacy key', async () => {
    const recentDate = new Date('2026-11-18T12:00:00Z');
    const retail = { id: 'z-store', agencyId: '999', name: 'Zulu Retail', city: null, county: null, phone: null };
    const db = {
      loggedVisit: {
        groupBy: async (args: { where: { organizationId: string; locationType: string }; take?: number }) => {
          assert.equal(args.where.organizationId, 'tenant-a');
          if (!args.take) return [];
          assert.equal(args.take, 5);
          return args.where.locationType === 'agency' ? [{ agencyId: '999', _max: { visitAt: recentDate } }] : [];
        },
      },
      agency: {
        findMany: async (args: { take?: number; where?: unknown }) => {
          if (!args.take) {
            assert.deepEqual(args.where, { OR: [{ id: { in: ['999'] } }, { agencyId: { in: ['999'] } }] });
            return [retail];
          }
          assert.equal(args.take, 5);
          return Array.from({ length: 5 }, (_, i) => ({ ...retail, id: `agency-${i}`, agencyId: String(i), name: `Alpha Retail ${i}` }));
        },
      },
      wholesaleAccount: {
        findMany: async (args: { take?: number }) => {
          assert.equal(args.take, 5);
          return [];
        },
      },
    } as unknown as PrismaClient;
    const { agencies, wholesaleAccounts } = await getVisitPickerSuggestions('tenant-a', db);
    assert.equal(agencies.length, 5);
    assert.equal(agencies[0].id, retail.id);
    assert.equal(agencies[0].lastVisitAt, recentDate.toISOString());
    assert.deepEqual(wholesaleAccounts, []);
  });
  it('adds last agency visit dates without N+1 queries and sorts the result', async () => {
    const db = {
      agency: {
        findMany: async () => [
          {
            agencyId: '10100',
            city: 'Columbus',
            county: 'Franklin',
            id: 'agency-b',
            name: 'Bravo Agency',
            phone: null,
          },
          {
            agencyId: '10200',
            city: 'Dayton',
            county: 'Montgomery',
            id: 'agency-a',
            name: 'Alpha Agency',
            phone: null,
          },
        ],
      },
      loggedVisit: {
        groupBy: async () => [
          {
            agencyId: 'agency-b',
            _max: { visitAt: new Date('2026-05-01T00:00:00.000Z') },
          },
          {
            agencyId: '10200',
            _max: { visitAt: new Date('2026-05-10T00:00:00.000Z') },
          },
        ],
      },
    } as unknown as PrismaClient;

    const result = await getAgenciesForVisitPicker({ db });

    assert.deepEqual(
      result.map((agency) => agency.id),
      ['agency-a', 'agency-b'],
    );
    assert.equal(result[0].lastVisitAt, '2026-05-10T00:00:00.000Z');
  });

  it('adds last wholesale visit dates and sorts active accounts', async () => {
    const db = {
      wholesaleAccount: {
        findMany: async () => [
          {
            agencyId: null,
            city: 'Cleveland',
            county: 'Cuyahoga',
            id: 'wholesale-b',
            licenseeId: '72045',
            name: 'Bravo Wholesale',
            phone: null,
          },
          {
            agencyId: null,
            city: 'Akron',
            county: 'Summit',
            id: 'wholesale-a',
            licenseeId: '72046',
            name: 'Alpha Wholesale',
            phone: null,
          },
        ],
      },
      loggedVisit: {
        groupBy: async () => [
          {
            wholesaleAccountId: 'wholesale-b',
            _max: { visitAt: new Date('2026-05-12T00:00:00.000Z') },
          },
        ],
      },
    } as unknown as PrismaClient;

    const result = await getWholesaleAccountsForVisitPicker({ db });

    assert.deepEqual(
      result.map((account) => account.id),
      ['wholesale-b', 'wholesale-a'],
    );
    assert.equal(result[0].lastVisitAt, '2026-05-12T00:00:00.000Z');
    assert.equal(result[1].lastVisitAt, null);
  });

  it('searches the full agency table by name, ID, address fields, or phone', async () => {
    let findManyArgs: Record<string, unknown> | undefined;
    const db = {
      agency: {
        findMany: async (args: Record<string, unknown>) => {
          findManyArgs = args;
          return [{ agencyId: '99999', city: 'Toledo', county: 'Lucas', id: 'agency-999', name: 'Far Away Spirits', phone: null }];
        },
      },
      loggedVisit: { groupBy: async () => [] },
    } as unknown as PrismaClient;

    const result = await searchAgenciesForVisitPicker({ db, query: 'Far Away' });

    assert.equal(result[0].id, 'agency-999');
    assert.equal(findManyArgs?.take, 50);
    const { OR: clauses } = findManyArgs?.where as { OR: unknown[] };
    assert.ok(clauses.some((clause) => Reflect.has(clause as object, 'name')));
    assert.ok(clauses.some((clause) => Reflect.has(clause as object, 'zip')));
  });

  it('searches all active wholesale accounts including alternate Licensee IDs', async () => {
    let findManyArgs: Record<string, unknown> | undefined;
    const db = {
      wholesaleAccount: {
        findMany: async (args: Record<string, unknown>) => {
          findManyArgs = args;
          return [{
            agencyId: null,
            city: 'Cincinnati',
            county: 'Hamilton',
            id: 'wholesale-999',
            licenseeId: '900001',
            licenseeIds: [{ licenseeId: '900001-A' }],
            name: 'Southern Account',
            phone: null,
          }];
        },
      },
      loggedVisit: { groupBy: async () => [] },
    } as unknown as PrismaClient;

    const result = await searchWholesaleAccountsForVisitPicker({ db, query: '900001-A' });

    assert.equal(result[0].id, 'wholesale-999');
    assert.equal(findManyArgs?.take, 50);
    assert.equal((findManyArgs?.where as { isActive: boolean }).isActive, true);
    const { OR: clauses } = findManyArgs?.where as { OR: unknown[] };
    assert.ok(clauses.some((clause) => Reflect.has(clause as object, 'licenseeIds')));
    assert.ok(clauses.some((clause) => Reflect.has(clause as object, 'zip')));
  });

  it('keeps a name match visible when city and address matches fill the candidate limit', async () => {
    const account = { agencyId: null, city: 'Zulu', county: null, phone: null, licenseeId: '1', licenseeIds: [] };
    const exact = { ...account, id: 'exact', name: 'Zulu' };
    const db = {
      wholesaleAccount: {
        findMany: async ({ where }: { where: { isActive: boolean; name?: { startsWith: string } } }) => {
          assert.equal(where.isActive, true);
          if (where.name?.startsWith === 'Zulu') return [exact];
          return Array.from({ length: 50 }, (_, i) => ({ ...account, id: `candidate-${i}`, name: `Alpha ${i}` }));
        },
      },
      loggedVisit: { groupBy: async () => [] },
    } as unknown as PrismaClient;
    const result = await searchWholesaleAccountsForVisitPicker({ db, query: 'Zulu' });
    assert.equal(result[0].id, exact.id);
    assert.equal(result.length, 20);
  });

  it('does not query the database until two search characters are entered', async () => {
    const db = {
      agency: { findMany: async () => assert.fail('findMany should not run') },
      wholesaleAccount: { findMany: async () => assert.fail('findMany should not run') },
    } as unknown as PrismaClient;

    assert.deepEqual(await searchAgenciesForVisitPicker({ db, query: 'a' }), []);
    assert.deepEqual(await searchWholesaleAccountsForVisitPicker({ db, query: ' ' }), []);
  });
});
