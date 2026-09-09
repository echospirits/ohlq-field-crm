import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { formatDistanceMiles, getDistanceMiles, parseCoordinates } from '../lib/location/distance';
import {
  didGeocodeAddressChange,
  getGeocodeResetForAddressChange,
  normalizeGeocodeAddress,
} from '../lib/location/geocode';
import { getNearbyAgencies, getNearbyWholesaleAccounts } from '../lib/location/nearbyAccounts';
import { NEARBY_ACCOUNT_LIMITS } from '../lib/location/nearbyLimits';
import { shouldAutomaticallyRequestLocation } from '../lib/location/locationPreference';
import { rankVisitSearchOptions } from '../lib/visitPickerOptions';

describe('location distance', () => {
  it('calculates Haversine miles and formats useful precision', () => {
    const miles = getDistanceMiles(
      { latitude: 39.9612, longitude: -82.9988 },
      { latitude: 39.1031, longitude: -84.512 },
    );
    assert.ok(miles > 95 && miles < 105);
    assert.equal(formatDistanceMiles(0.84), '0.8 mi');
    assert.equal(formatDistanceMiles(18.2), '18 mi');
    assert.equal(parseCoordinates(null, null), null);
    assert.deepEqual(parseCoordinates('39.9', '-83.0'), { latitude: 39.9, longitude: -83 });
  });
});

describe('geocode address caching', () => {
  const original = { address: '123 Main St', city: 'Columbus', state: 'OH', zip: '43215' };

  it('does not stale coordinates for cosmetically unchanged addresses', () => {
    const unchanged = { address: ' 123  MAIN ST ', city: 'columbus', state: 'oh', zip: '43215' };
    assert.equal(didGeocodeAddressChange(original, unchanged), false);
    assert.deepEqual(getGeocodeResetForAddressChange(original, unchanged), {});
    assert.equal(normalizeGeocodeAddress(original), '123 MAIN ST COLUMBUS OH 43215');
  });

  it('clears coordinates and queues geocoding after an address change', () => {
    const reset = getGeocodeResetForAddressChange(original, { ...original, address: '125 Main St' });
    assert.equal(reset.geocodeStatus, 'PENDING');
    assert.equal(reset.latitude, null);
    assert.equal(reset.normalizedGeocodeAddress, null);
  });
});

describe('nearby account behavior', () => {
  it('automatically refreshes location after opt-in or when browser permission is already granted', () => {
    assert.equal(shouldAutomaticallyRequestLocation(true, 'prompt'), true);
    assert.equal(shouldAutomaticallyRequestLocation(false, 'granted'), true);
    assert.equal(shouldAutomaticallyRequestLocation(false, 'prompt'), false);
    assert.equal(shouldAutomaticallyRequestLocation(true, 'denied'), false);
  });

  it('excludes missing coordinates, requests active accounts, and sorts closest first', async () => {
    let findManyWhere: Record<string, unknown> | undefined;
    const db = {
      wholesaleAccount: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          findManyWhere = where;
          return [
            { id: 'far', name: 'Far', latitude: 39.98, longitude: -83, city: 'Columbus', county: null, phone: null, agencyId: null, licenseeId: '2', licenseeIds: [] },
            { id: 'missing', name: 'Missing', latitude: null, longitude: null, city: null, county: null, phone: null, agencyId: null, licenseeId: '3', licenseeIds: [] },
            { id: 'near', name: 'Near', latitude: 39.962, longitude: -82.999, city: 'Columbus', county: null, phone: null, agencyId: null, licenseeId: '1', licenseeIds: [] },
          ];
        },
      },
      loggedVisit: { groupBy: async () => [] },
    } as unknown as PrismaClient;

    const results = await getNearbyWholesaleAccounts({ db, latitude: 39.9612, longitude: -82.9988 });
    assert.deepEqual(results.map((item) => item.id), ['near', 'far']);
    assert.equal(findManyWhere?.isActive, true);
    assert.equal(findManyWhere?.mergedIntoId, null);
  });

  it('returns four nearby agencies and fifteen nearby wholesale accounts by default', async () => {
    const makeCoordinates = (index: number) => ({
      latitude: 39.9612 + index * 0.001,
      longitude: -82.9988,
    });
    const db = {
      agency: {
        findMany: async () => Array.from({ length: 20 }, (_, index) => ({
          agencyId: String(index), city: 'Columbus', county: null, id: `agency-${index}`,
          ...makeCoordinates(index), name: `Agency ${index}`, phone: null,
        })),
      },
      wholesaleAccount: {
        findMany: async () => Array.from({ length: 20 }, (_, index) => ({
          agencyId: null, city: 'Columbus', county: null, id: `wholesale-${index}`,
          licenseeId: String(index), licenseeIds: [], ...makeCoordinates(index),
          name: `Wholesale ${index}`, phone: null,
        })),
      },
      loggedVisit: { groupBy: async () => [] },
    } as unknown as PrismaClient;

    const coordinates = { latitude: 39.9612, longitude: -82.9988 };
    const [agencies, wholesaleAccounts] = await Promise.all([
      getNearbyAgencies({ db, ...coordinates }),
      getNearbyWholesaleAccounts({ db, ...coordinates }),
    ]);

    assert.equal(agencies.length, NEARBY_ACCOUNT_LIMITS.agency);
    assert.equal(wholesaleAccounts.length, NEARBY_ACCOUNT_LIMITS.wholesale);
    assert.deepEqual(agencies.map(({ id }) => id), ['agency-0', 'agency-1', 'agency-2', 'agency-3']);
    assert.equal(wholesaleAccounts.at(-1)?.id, 'wholesale-14');
  });

  it('keeps strong text relevance ahead of proximity', () => {
    const results = rankVisitSearchOptions([
      { id: 'near', name: 'Not Buckeye', lastVisitAt: null, latitude: 39.9612, longitude: -82.9988 },
      { id: 'exact', name: 'Buckeye', lastVisitAt: null, latitude: 41.4993, longitude: -81.6944 },
    ], 'Buckeye', { latitude: 39.9612, longitude: -82.9988 });
    assert.equal(results[0].id, 'exact');
  });
});

