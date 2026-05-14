import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getLegacyAccountCreateDataFromWholesaleAccount,
  getWholesaleCreateDataFromOfficialAccount,
  normalizeWholesaleLicenseeId,
} from '../lib/wholesaleAccounts';

describe('normalizeWholesaleLicenseeId', () => {
  it('preserves leading zeroes and punctuation while normalizing case', () => {
    assert.equal(normalizeWholesaleLicenseeId(' 00072045-1 '), '00072045-1');
    assert.equal(normalizeWholesaleLicenseeId('t40949003'), 'T40949003');
    assert.equal(normalizeWholesaleLicenseeId(null), null);
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
    assert.equal(data.isActive, true);
    assert.deepEqual(data.officialAccount, { connect: { id: 'official-1' } });
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
