import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getLegacyAccountCreateDataFromWholesaleAccount,
  getWholesaleCreateDataFromOfficialAccount,
  getWholesaleEditableValuesFromOfficialAccount,
  getWholesaleLicenseeIdValues,
  mergeWholesaleEditableValuesWithOfficialDefaults,
  normalizeWholesaleLicenseeId,
  parseWholesaleLicenseeIds,
} from '../lib/wholesaleAccounts';

describe('normalizeWholesaleLicenseeId', () => {
  it('preserves leading zeroes and punctuation while normalizing case', () => {
    assert.equal(normalizeWholesaleLicenseeId(' 00072045-1 '), '00072045-1');
    assert.equal(normalizeWholesaleLicenseeId('t40949003'), 'T40949003');
    assert.equal(normalizeWholesaleLicenseeId(null), null);
  });
});

describe('parseWholesaleLicenseeIds', () => {
  it('normalizes multiple IDs while preserving entry order', () => {
    assert.deepEqual(parseWholesaleLicenseeIds(' 00072045-1\n72045; t40949003,00072045-1 '), [
      '00072045-1',
      '72045',
      'T40949003',
    ]);
  });
});

describe('getWholesaleLicenseeIdValues', () => {
  it('uses the account primary ID first and includes aliases once', () => {
    assert.deepEqual(
      getWholesaleLicenseeIdValues({
        licenseeId: '72045',
        licenseeIds: [{ licenseeId: '00072045-1' }, { licenseeId: '72045' }],
      }),
      ['72045', '00072045-1'],
    );
  });
});

describe('getWholesaleCreateDataFromOfficialAccount', () => {
  it('uses official fields only as initial activation values', () => {
    const data = getWholesaleCreateDataFromOfficialAccount(
      {
        address: '37565 Colorado Av',
        agencyRefId: '40949',
        city: 'Avon',
        county: 'Lorain',
        deliveryDay: 'Tuesday',
        districtId: '9',
        id: 'official-1',
        licenseeId: 't40949003',
        name: '1 Stop Beverage Shop',
        ownership: 'Independent',
        phone: 'N/A',
        state: 'OH',
        zip: '44011',
      },
      'user-1',
    );

    assert.equal(data.licenseeId, 'T40949003');
    assert.equal(data.name, '1 Stop Beverage Shop');
    assert.equal(data.agencyId, '40949');
    assert.equal(data.deliveryDay, 'Tuesday');
    assert.equal(data.isActive, true);
    assert.deepEqual(data.officialAccount, { connect: { id: 'official-1' } });
    assert.deepEqual(data.licenseeIds, { create: [{ isPrimary: true, licenseeId: 'T40949003' }] });
  });
});

describe('mergeWholesaleEditableValuesWithOfficialDefaults', () => {
  const officialValues = getWholesaleEditableValuesFromOfficialAccount({
    address: '37565 Colorado Av',
    agencyRefId: '40949',
    city: 'Avon',
    county: 'Lorain',
    deliveryDay: 'Tuesday',
    districtId: '9',
    id: 'official-1',
    licenseeId: 't40949003',
    name: '1 Stop Beverage Shop',
    ownership: 'Independent',
    phone: '4405550101',
    state: 'OH',
    zip: '44011',
  });

  it('replaces unchanged generated fields with official account defaults', () => {
    const merged = mergeWholesaleEditableValuesWithOfficialDefaults({
      existingValues: {
        address: null,
        agencyId: 'AUTO-1',
        city: null,
        county: null,
        deliveryDay: null,
        districtId: null,
        name: 'Old generated wholesale account',
        ownership: null,
        phone: null,
        state: 'OH',
        zip: null,
      },
      officialValues,
      submittedValues: {
        address: null,
        agencyId: 'AUTO-1',
        city: null,
        county: null,
        deliveryDay: null,
        districtId: null,
        name: 'Old generated wholesale account',
        ownership: null,
        phone: null,
        state: 'OH',
        zip: null,
      },
    });

    assert.equal(merged.name, '1 Stop Beverage Shop');
    assert.equal(merged.agencyId, '40949');
    assert.equal(merged.address, '37565 Colorado Av');
    assert.equal(merged.deliveryDay, 'Tuesday');
  });

  it('keeps field edits made during the same save over official defaults', () => {
    const merged = mergeWholesaleEditableValuesWithOfficialDefaults({
      existingValues: {
        address: null,
        agencyId: 'AUTO-1',
        city: null,
        county: null,
        deliveryDay: null,
        districtId: null,
        name: 'Old generated wholesale account',
        ownership: null,
        phone: null,
        state: 'OH',
        zip: null,
      },
      officialValues,
      submittedValues: {
        address: null,
        agencyId: 'AUTO-1',
        city: null,
        county: null,
        deliveryDay: 'Friday',
        districtId: null,
        name: 'Custom account name',
        ownership: null,
        phone: null,
        state: 'OH',
        zip: null,
      },
    });

    assert.equal(merged.name, 'Custom account name');
    assert.equal(merged.deliveryDay, 'Friday');
    assert.equal(merged.agencyId, '40949');
  });
});

describe('getLegacyAccountCreateDataFromWholesaleAccount', () => {
  it('creates a legacy backing account without requiring future updates to overwrite official records', () => {
    const data = getLegacyAccountCreateDataFromWholesaleAccount({
      address: '985 W 6th Ave',
      agencyId: '90399',
      city: 'Columbus',
      county: 'Franklin',
      districtId: '1',
      licenseeId: 'Z90399001',
      name: 'Echo Spirits',
      ownership: 'Echo',
      phone: '6147251955',
      state: null,
      zip: '43212',
    });

    assert.equal(data.licenseeId, 'Z90399001');
    assert.equal(data.agencyRefId, '90399');
    assert.equal(data.state, 'OH');
  });
});
