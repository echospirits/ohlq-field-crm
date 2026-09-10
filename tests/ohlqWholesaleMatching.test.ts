import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  areOhlqAddressesSame,
  getOhlqLicenseeMatchKeys,
  licenseeIdsMatch,
  normalizeOhlqLicenseeMatchKey,
  resolveOhlqWholesaleSalesLookup,
  salesPermitMatchesLookup,
} from '../lib/ohlqWholesaleMatching';

describe('OHLQ wholesale licensee matching', () => {
  it('matches sales permit variants with leading zeroes and location suffixes', () => {
    assert.equal(normalizeOhlqLicenseeMatchKey('00072045-1'), '72045');
    assert.equal(normalizeOhlqLicenseeMatchKey('72045'), '72045');
    assert.deepEqual(getOhlqLicenseeMatchKeys('00072045-2'), ['00072045-2', '72045']);
    assert.deepEqual(getOhlqLicenseeMatchKeys('98185250010'), ['98185250010', '9818525']);
    assert.equal(licenseeIdsMatch('98185250010', '9818525-0010'), true);
    assert.equal(licenseeIdsMatch('72045', '00072045-2'), true);
    assert.equal(licenseeIdsMatch('7643214-0010', '7643214-0020'), false);
    assert.equal(licenseeIdsMatch('7643214-0010', '07643214-1'), false);
  });

  it('matches one address within a multi-address licensed location', () => {
    assert.equal(
      areOhlqAddressesSame(
        { address: '4850 & 5350 W Powell Rd', city: 'Powell', state: 'OH', zip: '43065' },
        { address: '5350 West Powell Road', city: 'Powell', state: 'Ohio', zip: '43065-9001' },
      ),
      true,
    );
  });

  it('normalizes common address spelling differences for official account matching', () => {
    assert.equal(
      areOhlqAddressesSame(
        { address: '123 North Main Street', city: 'Columbus', state: 'OH', zip: '43215-1234' },
        { address: '123 N Main St.', city: 'COLUMBUS', state: 'Ohio', zip: '43215' },
      ),
      true,
    );
    assert.equal(
      areOhlqAddressesSame(
        { address: '985 W Sixth Avenue', city: 'Columbus', state: 'OH' },
        { address: '985 West 6th Ave', city: 'Columbus', state: 'OH' },
      ),
      true,
    );
  });

  it('adds official licensee IDs from the same address to the sales lookup', async () => {
    const db = {
      account: {
        findMany: async () => [
          {
            address: '123 N Main St.',
            city: 'Columbus',
            id: 'official-1',
            licenseeId: '00072045-1',
            state: 'OH',
            zip: '43215',
          },
        ],
      },
    } as unknown as PrismaClient;

    const lookup = await resolveOhlqWholesaleSalesLookup({
      account: {
        address: '123 North Main Street',
        city: 'Columbus',
        licenseeId: '72045',
        state: 'OH',
        zip: '43215-1234',
      },
      db,
    });

    assert.equal(lookup.permitNumbers.has('72045'), true);
    assert.equal(lookup.permitNumbers.has('00072045-1'), true);
    assert.equal(salesPermitMatchesLookup('00072045-2', lookup), true);
  });

  it('does not add same-address official IDs when an address has too many licensees', async () => {
    const db = {
      account: {
        findMany: async () =>
          Array.from({ length: 13 }, (_, index) => ({
            address: '492 Armstrong St',
            city: 'Columbus',
            id: `official-${index}`,
            licenseeId: `AGENCY-${index}`,
            state: 'OH',
            zip: '43215',
          })),
      },
    } as unknown as PrismaClient;

    const lookup = await resolveOhlqWholesaleSalesLookup({
      account: {
        address: '492 Armstrong Street',
        city: 'Columbus',
        licenseeId: '98185250010',
        state: 'OH',
        zip: '43215',
      },
      db,
    });

    assert.equal(lookup.permitNumbers.has('98185250010'), true);
    assert.equal(lookup.permitNumbers.has('AGENCY-0'), false);
  });

  it('uses explicit wholesale account licensee aliases in the sales lookup', async () => {
    const db = {
      account: {
        findMany: async () => [],
      },
    } as unknown as PrismaClient;

    const lookup = await resolveOhlqWholesaleSalesLookup({
      account: {
        licenseeId: '72045',
        licenseeIds: [{ licenseeId: '00072045-1' }, { licenseeId: 'T40949003' }],
      },
      db,
    });

    assert.equal(lookup.primaryLicenseeId, '72045');
    assert.equal(salesPermitMatchesLookup('00072045-2', lookup), true);
    assert.equal(salesPermitMatchesLookup('t40949003', lookup), true);
  });

  it('does not attribute sibling location-family sales to Cincinnati Zoo', async () => {
    const db = {
      account: {
        findMany: async () => [
          {
            address: '3400 VINE ST', city: 'CINCINNATI', id: 'cincinnati-location',
            licenseeId: '7643214-0020', state: 'OH', zip: '45220',
          },
          {
            address: '5350 W POWELL RD', city: 'POWELL', id: 'columbus-family',
            licenseeId: '7643214', state: 'OH', zip: '43065',
          },
        ],
      },
    } as unknown as PrismaClient;

    const lookup = await resolveOhlqWholesaleSalesLookup({
      account: {
        address: '3400 VINE ST', city: 'CINCINNATI', licenseeId: '7643214-0020',
        licenseeIds: [{ licenseeId: '7990815' }], state: 'OH', zip: '45220',
      },
      db,
    });

    assert.equal(lookup.permitNumbers.has('7643214'), false);
    assert.equal(salesPermitMatchesLookup('07643214-3', lookup), false);
  });

  it('retains family-format sales for the corroborated Columbus Zoo location', async () => {
    const db = {
      account: {
        findMany: async () => [
          {
            address: '4850 & 5350 W POWELL RD', city: 'POWELL', id: 'columbus-location',
            licenseeId: '7643214-0010', state: 'OH', zip: '43065',
          },
          {
            address: '5350 W POWELL RD', city: 'POWELL', id: 'columbus-family',
            licenseeId: '7643214', state: 'OH', zip: '43065',
          },
        ],
      },
    } as unknown as PrismaClient;

    const lookup = await resolveOhlqWholesaleSalesLookup({
      account: {
        address: '4850 & 5350 W POWELL RD', city: 'POWELL', licenseeId: '7643214-0010',
        state: 'OH', zip: '43065',
      },
      db,
    });

    assert.equal(lookup.permitNumbers.has('7643214'), true);
    assert.equal(salesPermitMatchesLookup('07643214-3', lookup), true);
  });
});
