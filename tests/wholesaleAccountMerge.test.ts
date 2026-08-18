import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  getWholesaleMergeDestinationFallbacks,
  getWholesaleMergeCandidates,
  getWholesaleMergeLicenseeIds,
  isEligibleWholesaleMergeTarget,
  rankWholesaleMergeCandidates,
  type MergeAccountValues,
  type WholesaleMergeCandidate,
} from '../lib/wholesaleAccountMerge';

const account = ({
  licenseeId,
  licenseeIds = [],
  ...overrides
}: Omit<Partial<MergeAccountValues>, 'licenseeId' | 'licenseeIds'> & {
  licenseeId: string;
  licenseeIds?: string[];
}) => ({
  address: null,
  agencyId: null,
  city: null,
  county: null,
  deliveryDay: null,
  districtId: null,
  licenseeId,
  licenseeIds: licenseeIds.map((value) => ({ licenseeId: value })),
  name: 'Account',
  ownership: null,
  phone: null,
  state: 'OH',
  zip: null,
  ...overrides,
});

const candidate = ({
  id,
  licenseeId,
  licenseeIds = [licenseeId],
  ...overrides
}: Omit<Partial<WholesaleMergeCandidate>, 'id' | 'licenseeId' | 'licenseeIds'> & {
  id: string;
  licenseeId: string;
  licenseeIds?: string[];
}): WholesaleMergeCandidate => ({
  address: null,
  city: null,
  id,
  isActive: true,
  licenseeId,
  licenseeIds: licenseeIds.map((value) => ({ licenseeId: value })),
  mergedIntoId: null,
  name: `Account ${id}`,
  officialAccountId: null,
  state: 'OH',
  zip: null,
  ...overrides,
});

describe('getWholesaleMergeLicenseeIds', () => {
  it('keeps official IDs and transfers real aliases from the manual account', () => {
    const source = account({
      licenseeId: 'manual-new-bar-mbv71lfl',
      licenseeIds: ['manual-new-bar-mbv71lfl', '1234567'],
    });
    const destination = account({
      licenseeId: '00072045-1',
      licenseeIds: ['00072045-1', '00072045'],
    });

    assert.deepEqual(getWholesaleMergeLicenseeIds(source, destination), [
      '00072045-1',
      '00072045',
      '1234567',
    ]);
  });

  it('does not transfer generated manual identifiers', () => {
    const source = account({
      licenseeId: 'manual-new-bar-mbv71lfl',
      licenseeIds: ['manual-new-bar-mbv71lfl'],
    });
    const destination = account({ licenseeId: '00072045-1', licenseeIds: ['00072045-1'] });

    assert.deepEqual(getWholesaleMergeLicenseeIds(source, destination), ['00072045-1']);
  });
});

describe('getWholesaleMergeDestinationFallbacks', () => {
  it('preserves official values and fills blank operational fields from the manual account', () => {
    const source = account({
      licenseeId: 'manual-new-bar',
      address: '10 New Street',
      city: 'Columbus',
      phone: '614-555-0100',
      ownership: 'Independent',
    });
    const destination = account({
      licenseeId: '1234567',
      address: '10 Official Street',
      city: null,
      phone: null,
      ownership: 'Official ownership',
    });

    assert.deepEqual(getWholesaleMergeDestinationFallbacks(source, destination), {
      address: '10 Official Street',
      agencyId: null,
      city: 'Columbus',
      county: null,
      deliveryDay: null,
      districtId: null,
      ownership: 'Official ownership',
      phone: '614-555-0100',
      state: 'OH',
      zip: null,
    });
  });
});

describe('wholesale merge destination discovery', () => {
  const source = candidate({
    id: 'manual-ethyl',
    licenseeId: 'manual-ethyl-and-tank-mrb49ss2',
    name: 'Ethyl and Tank',
  });
  const destination = candidate({
    city: 'COLUMBUS',
    id: 'ethyl-official',
    licenseeId: '06430432-1',
    name: 'Ethyl & Tank',
    zip: '43201',
  });

  it('accepts an active destination with a real Licensee ID even without an officialAccountId link', () => {
    assert.equal(isEligibleWholesaleMergeTarget(destination), true);
    assert.equal(isEligibleWholesaleMergeTarget(source), false);
  });

  it('ranks ampersand and word variants as the most likely name match', () => {
    const ranked = rankWholesaleMergeCandidates({
      candidates: [
        candidate({ id: 'other', licenseeId: '10000001', name: 'Ethyl Beverage Company' }),
        destination,
      ],
      query: '',
      source,
    });

    assert.equal(ranked[0].id, destination.id);
  });

  it('searches normalized names and exact Licensee IDs', () => {
    const candidates = [destination, candidate({ id: 'other', licenseeId: '10000001' })];

    assert.equal(
      rankWholesaleMergeCandidates({ candidates, query: 'Ethyl and Tank', source })[0].id,
      destination.id,
    );
    assert.equal(
      rankWholesaleMergeCandidates({ candidates, query: '06430432-1', source })[0].id,
      destination.id,
    );
  });

  it('loads the full active pool before ranking instead of taking the first 50 alphabetically', async () => {
    let findManyArgs: Record<string, unknown> | undefined;
    const alphabeticallyEarlier = Array.from({ length: 60 }, (_, index) =>
      candidate({
        id: `account-${index}`,
        licenseeId: `1000${String(index).padStart(4, '0')}`,
        name: `A Account ${String(index).padStart(2, '0')}`,
      }),
    );
    const db = {
      wholesaleAccount: {
        findMany: async (args: Record<string, unknown>) => {
          findManyArgs = args;
          return [...alphabeticallyEarlier, destination];
        },
      },
    } as unknown as PrismaClient;

    const result = await getWholesaleMergeCandidates({ db, query: '', source });

    assert.equal(findManyArgs?.take, undefined);
    assert.equal(result.eligibleCount, 61);
    assert.equal(result.matchCount, 61);
    assert.equal(result.candidates.length, 50);
    assert.equal(result.candidates[0].id, destination.id);
  });
});
