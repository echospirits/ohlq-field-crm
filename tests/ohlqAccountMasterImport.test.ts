import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAccountMasterSelectionIsSafe,
  chooseAccountMasterDuplicate,
  choosePrimaryAccountMasterRow,
  getImportedWholesaleName,
  groupAccountMasterRowsByLocation,
  rowMatchesWholesaleImportIdentity,
  parseAccountMasterCsv,
  type AccountMasterRow,
} from '../lib/ohlqAccountMasterImport';
import { getOhlqAccountMasterDate, getOhlqAccountMasterFilename } from '../lib/ohlqAnnualSalesReport';

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

test('requires a complete, non-sparse Account Master before import', () => {
  const result = parseAccountMasterCsv([
    'LicenseeID,AgencyID,Ownership,DBA,Address,City,County,ZipCode,DistrictId,DeliveryDay,PhoneNumber',
    '3,100,Usable Owner,Public House,Three St,Akron,Summit,44301,GRN,N/A,N/A',
  ].join('\n'));
  assert.doesNotThrow(() => assertAccountMasterSelectionIsSafe(result, { minimumSelectedRows: 1 }));
  assert.throws(() => assertAccountMasterSelectionIsSafe(result), /expected at least 10000/);

  const missingHeaders = parseAccountMasterCsv('LicenseeID,Ownership,DBA\n3,Usable Owner,Public House');
  assert.throws(
    () => assertAccountMasterSelectionIsSafe(missingHeaders, { minimumSelectedRows: 1 }),
    /missing required header/,
  );
});

test('uses the current Eastern date and exact OHLQ Account Master filename', () => {
  assert.equal(getOhlqAccountMasterDate(new Date('2026-09-05T03:30:00.000Z')), '2026-09-04');
  assert.equal(getOhlqAccountMasterDate(new Date('2026-09-05T12:00:00.000Z')), '2026-09-05');
  assert.equal(getOhlqAccountMasterFilename('2026-09-05'), 'OHLQData_Account_Master2026-09-05.csv');
  assert.throws(() => getOhlqAccountMasterFilename('09-05-2026'), /Invalid Account Master report date/);
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

test('groups related Licensee IDs at one physical location', () => {
  const groups = groupAccountMasterRowsByLocation([
    row({ licenseeId: '0258173-00003', name: 'MAYFIELD SAND RIDGE CLUB' }),
    row({ licenseeId: '0258173-00004', name: 'MAYFIELD SAND RIDGE CLUB' }),
    row({ licenseeId: '0258173-00005', name: 'MAYFIELD CURLING CLUB' }),
    row({ licenseeId: '0258173-0005', name: 'OTHER LOCATION', address: '12150 MAYFIELD RD', zip: '44024' }),
  ]);

  assert.deepEqual(groups.map((group) => group.map((item) => item.licenseeId).sort()).sort((a, b) => a.length - b.length), [
    ['0258173-0005'],
    ['0258173-00003', '0258173-00004', '0258173-00005'],
  ]);
});

test('groups historical licenses with the same name and location', () => {
  const groups = groupAccountMasterRowsByLocation([
    row({ licenseeId: '1111111', name: 'TEAK OTR', ownership: 'TEAK OWNER' }),
    row({ licenseeId: '2222222', name: 'TEAK OTR', ownership: 'TEAK OWNER' }),
    row({ licenseeId: '3333333', name: 'DIFFERENT TENANT', ownership: 'OTHER OWNER' }),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups.find((group) => group.some((item) => item.name === 'TEAK OTR'))?.length, 2);
});

test('groups DBA and ownership variants at the same licensed location', () => {
  const groups = groupAccountMasterRowsByLocation([
    row({ licenseeId: '08840720-27', name: 'SCRAMBLERS', ownership: 'SCRAMBLERS' }),
    row({ licenseeId: '5598704', name: 'DBA SCRAMBLERS', ownership: 'MASA RESTAURANT GROUP LLC' }),
    row({ licenseeId: '0951198', name: 'BRIDGE PARK HOTEL LLC', ownership: 'BRIDGE PARK HOTEL LLC' }),
    row({ licenseeId: '0951198-00003', name: 'VASO', ownership: 'BRIDGE PARK HOTEL LLC' }),
  ]);
  assert.deepEqual(groups.map((group) => group.map((item) => item.licenseeId).sort()), [
    ['08840720-27', '5598704'],
    ['0951198', '0951198-00003'],
  ]);
});

test('keeps unrelated businesses at a shared address separate', () => {
  const groups = groupAccountMasterRowsByLocation([
    row({ licenseeId: '03993801-1', name: 'PGA TOUR GRILL', ownership: 'PGA TOUR GRILL' }),
    row({ licenseeId: '03993801-2', name: 'CHILIS', ownership: 'CHILIS' }),
    row({ licenseeId: '03993801-6', name: 'LAND GRANT BREWING', ownership: 'LAND GRANT BREWING' }),
  ]);
  assert.equal(groups.length, 3);
});

test('does not use a matching name to join license-family accounts at different addresses', () => {
  assert.equal(rowMatchesWholesaleImportIdentity(
    row({ licenseeId: '3157115-00003', name: 'GERVASI 1700 LLC', address: '1700 55TH ST NE', zip: '44721' }),
    { name: 'Gervasi 1700 LLC', address: '7160 FULTON DR NW', city: 'Jackson Twp', state: 'OH', zip: '44718' },
  ), false);
});

test('chooses the most representative DBA as the location primary', () => {
  const primary = choosePrimaryAccountMasterRow([
    row({ licenseeId: '0258173', name: 'ARECO GOLF LLC', dba: null }),
    row({ licenseeId: '0258173-00003', name: 'MAYFIELD SAND RIDGE CLUB', dba: 'MAYFIELD SAND RIDGE CLUB' }),
    row({ licenseeId: '0258173-00004', name: 'MAYFIELD SAND RIDGE CLUB', dba: 'MAYFIELD SAND RIDGE CLUB' }),
  ]);
  assert.equal(primary.licenseeId, '0258173-00003');
});
