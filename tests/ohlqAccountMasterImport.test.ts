import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseAccountMasterDuplicate,
  getImportedWholesaleName,
  parseAccountMasterCsv,
  type AccountMasterRow,
} from '../lib/ohlqAccountMasterImport';

const row = (overrides: Partial<AccountMasterRow> = {}): AccountMasterRow => ({
  licenseeId: '0001234',
  agencyId: '40880',
  ownership: 'FIRE AND ICE BAR AND GRILL',
  dba: null,
  name: 'FIRE AND ICE BAR AND GRILL',
  address: '1941 TRIPLETT BLVD',
  city: 'AKRON',
  county: 'SUMMIT',
  state: 'OH',
  zip: '44312',
  districtId: 'GRN',
  deliveryDay: null,
  phone: null,
  ...overrides,
});

test('filters Transient from either DBA or Ownership and prefers DBA as the account name', () => {
  const result = parseAccountMasterCsv([
    'LicenseeID,AgencyID,Ownership,DBA,Address,City,County,ZipCode,DistrictId,DeliveryDay,PhoneNumber',
    '1,100,Transient Owner,Usable DBA,One St,Akron,Summit,44301,GRN,N/A,N/A',
    '2,100,Usable Owner,Temporary Transient,Two St,Akron,Summit,44301,GRN,N/A,N/A',
    '3,100,Usable Owner,Public House,Three St,Akron,Summit,44301,GRN,N/A,N/A',
  ].join('\n'));

  assert.equal(result.excludedTransientRows, 2);
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].name, 'Public House');
});

test('uses an existing address match to resolve a duplicated Licensee ID', () => {
  const chosen = chooseAccountMasterDuplicate(
    [row(), row({ name: 'OTHER ACCOUNT', ownership: 'OTHER ACCOUNT', address: '99 OTHER ST' })],
    [{ name: 'Legacy custom name', address: '1941 Triplett Blvd', city: 'Akron', zip: '44312', agencyId: '40880' }],
  );

  assert.equal(chosen?.name, 'FIRE AND ICE BAR AND GRILL');
});

test('does not guess when duplicated rows have no strong unique existing match', () => {
  const chosen = chooseAccountMasterDuplicate(
    [row(), row({ name: 'OTHER ACCOUNT', ownership: 'OTHER ACCOUNT', address: '99 OTHER ST' })],
    [],
  );
  assert.equal(chosen, null);
});

test('uses the non-repeated business when a duplicate ID contains a repeated contaminant row', () => {
  const result = parseAccountMasterCsv([
    'LicenseeID,AgencyID,Ownership,DBA,Address,City,County,ZipCode,DistrictId,DeliveryDay,PhoneNumber',
    '1,100,Expected Account,,One St,Akron,Summit,44301,GRN,N/A,N/A',
    '1,200,Repeated Source,,Two St,Columbus,Franklin,43215,GPT,N/A,N/A',
    '2,200,Repeated Source,,Two St,Columbus,Franklin,43215,GPT,N/A,N/A',
  ].join('\n'));

  assert.equal(result.ambiguous.length, 0);
  assert.equal(result.selected.find((item) => item.licenseeId === '1')?.name, 'Expected Account');
});

test('uses the production identity decision for the one equal-frequency duplicate', () => {
  const result = parseAccountMasterCsv([
    'LicenseeID,AgencyID,Ownership,DBA,Address,City,County,ZipCode,DistrictId,DeliveryDay,PhoneNumber',
    '3843801-0015,10542,ONE OWNER,MISERY & JEN,One St,Hamilton,Butler,45011,GPT,N/A,N/A',
    '3843801-0015,10542,SAI MATHURE LLC,LIBERTY WINE & LIQUOR,Two St,Hamilton,Butler,45011,GPT,N/A,N/A',
  ].join('\n'));

  assert.equal(result.ambiguous.length, 0);
  assert.equal(result.selected[0].name, 'LIBERTY WINE & LIQUOR');
});

test('preserves an active wholesale name and refreshes an inactive one', () => {
  assert.equal(getImportedWholesaleName({ currentName: 'Custom Name', officialName: 'Official Name', wasActive: true }), 'Custom Name');
  assert.equal(getImportedWholesaleName({ currentName: 'Licensee 123', officialName: 'Official Name', wasActive: false }), 'Official Name');
});
