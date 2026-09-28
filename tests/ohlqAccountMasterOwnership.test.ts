import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAccountMasterCsv } from '../lib/ohlqAccountMasterImport';
import {
  accountMasterRowsBelongToOwner,
  getAccountMasterAliasTransfers,
  getAccountMasterOwnershipConflicts,
  partitionAccountMasterLocationByOwner,
  resolveAccountMasterWholesaleOwner,
} from '../lib/ohlqAccountMasterOwnership';

const rows = parseAccountMasterCsv([
  'LicenseeID,AgencyID,Ownership,DBA,Address,City,County,ZipCode,DistrictId,DeliveryDay,PhoneNumber',
  '0898401-00515,30735,BPOE LODGE051,,1536 VILLA RD 18,SPRINGFIELD,CLARK,45503,GPT,N/A,N/A',
  '0898401-05103,30735,SPRINGFIELD OHIO BPOE051,SPRINGFIELD OHIO ELKS LODGE,1536 VILLA RD 18,Springfield,CLARK,45503,GPT,N/A,N/A',
].join('\n')).selected;

const account = (id: string, licenseeId: string, address: string) => ({
  id, licenseeId, officialAccountId: `official-${id}`, isActive: true,
  name: id, address, city: 'SPRINGFIELD', state: 'OH', zip: '45503',
  licenseeIds: [{ licenseeId }],
});
const fixtures = () => [
  account('bpoe', '0898401-00515', '1536 VILLA RD 18HOLE GOLF & PRO SHOP'),
  account('springfield', '0898401-05103', '1536 VILLA RD 18'),
];

test('repeated imports preserve both Elks owners when the source shortens an address', () => {
  const accounts = fixtures();
  const officialIds = new Map(accounts.map(item => [item.officialAccountId, item.licenseeId]));
  for (let pass = 0; pass < 2; pass++) {
    const owners = new Map(accounts.flatMap(item => [item.licenseeId, ...item.licenseeIds.map(alias => alias.licenseeId)].map(id => [id, item] as const)));
    const plans = rows.map(row => ({ rows: [row], account: resolveAccountMasterWholesaleOwner({
      row, exact: owners.get(row.licenseeId), candidates: accounts, sourceKeyIsUnique: false,
    }) }));
    assert.deepEqual(plans.map(plan => plan.account?.id), ['bpoe', 'springfield']);
    assert.deepEqual(getAccountMasterAliasTransfers(plans, owners), []);
    for (const plan of plans) {
      const target = plan.account!;
      target.address = plan.rows[0].address!;
      target.licenseeIds = plan.rows.map(row => ({ licenseeId: row.licenseeId }));
    }
    assert.deepEqual(getAccountMasterOwnershipConflicts(accounts, officialIds), []);
  }
});

test('existing alias ownership also survives address corrections', () => {
  const [existing, other] = fixtures();
  assert.equal(resolveAccountMasterWholesaleOwner({ row: rows[0], exact: existing, candidates: [other], sourceKeyIsUnique: true }), existing);
});

test('new IDs can still use unique address evidence but ambiguous matches remain unresolved', () => {
  const accounts = fixtures();
  assert.equal(resolveAccountMasterWholesaleOwner({ row: rows[0], exact: undefined, candidates: accounts, sourceKeyIsUnique: false }), accounts[1]);
  const sameAddress = accounts.map(item => ({ ...item, address: rows[0].address }));
  assert.equal(resolveAccountMasterWholesaleOwner({ row: rows[0], exact: undefined, candidates: sameAddress, sourceKeyIsUnique: false }), null);
  assert.equal(resolveAccountMasterWholesaleOwner({ row: rows[0], exact: undefined, candidates: [accounts[0]], sourceKeyIsUnique: true }), accounts[0]);
});

test('preflight refuses a location grouping that would transfer an existing ID', () => {
  const [original, other] = fixtures();
  const owners = new Map([[original.licenseeId, original], [other.licenseeId, other]]);
  assert.deepEqual(getAccountMasterAliasTransfers([{ rows, account: other }], owners), [{
    licenseeId: original.licenseeId, fromAccountId: original.id, toAccountId: other.id,
  }]);
  assert.equal(getAccountMasterAliasTransfers([{ rows: [rows[0]], account: null }], owners).length, 1);
  assert.deepEqual(getAccountMasterAliasTransfers([{ rows: [{ ...rows[0], licenseeId: 'NEW-ID' }], account: other }], owners), []);
});

test('ownership verification detects the production alias collision regardless of account order', () => {
  const accounts = fixtures();
  accounts[0].licenseeIds = [];
  accounts[1].licenseeIds.push({ licenseeId: accounts[0].licenseeId });
  const expected = [{ licenseeId: '0898401-00515', accountIds: ['bpoe', 'springfield'] }];
  assert.deepEqual(getAccountMasterOwnershipConflicts(accounts, new Map()), expected);
  assert.deepEqual(getAccountMasterOwnershipConflicts([...accounts].reverse(), new Map()), expected);
});

test('ownership verification includes official links and normalizes identifiers', () => {
  const accounts = fixtures();
  const officialIds = new Map([[accounts[1].officialAccountId, ` ${accounts[0].licenseeId.toLowerCase()} `]]);
  assert.deepEqual(getAccountMasterOwnershipConflicts(accounts, officialIds), [{
    licenseeId: '0898401-00515', accountIds: ['bpoe', 'springfield'],
  }]);
  assert.deepEqual(getAccountMasterOwnershipConflicts([accounts[0]], new Map([[accounts[0].officialAccountId, accounts[0].licenseeId]])), []);
});

test('source location consolidation preserves multiple established primary owners', () => {
  const accounts = fixtures();
  const owners = new Map(accounts.map(item => [item.licenseeId, item]));
  assert.deepEqual(partitionAccountMasterLocationByOwner(rows, owners), [[rows[0]], [rows[1]]]);
  const newRow = { ...rows[0], licenseeId: 'NEW-ID' };
  assert.deepEqual(partitionAccountMasterLocationByOwner([...rows, newRow], owners), [[rows[0]], [rows[1]], [newRow]]);
  assert.deepEqual(partitionAccountMasterLocationByOwner([rows[0], newRow], owners), [[rows[0], newRow]]);
});

test('existing aliases at differently formatted source addresses stay on their owner', () => {
  const owner = account('pearl', '10007638-1', '5606 PEARL RD');
  const owners = new Map([['10007638-1', owner], ['2760405', owner]]);
  const sourceRows = [
    { ...rows[0], licenseeId: '10007638-1', address: '5606 Pearl Road & Patio' },
    { ...rows[0], licenseeId: '2760405', address: '5606 PEARL RD' },
  ];
  assert.equal(accountMasterRowsBelongToOwner(sourceRows, owner.id, owners), true);
  assert.equal(accountMasterRowsBelongToOwner([...sourceRows, { ...sourceRows[0], licenseeId: 'NEW-ID' }], owner.id, owners), false);
  assert.equal(accountMasterRowsBelongToOwner([], owner.id, owners), false);
});
