import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  getAgenciesForVisitPicker,
  getInitialVisitLocationType,
  getWholesaleAccountsForVisitPicker,
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
});
