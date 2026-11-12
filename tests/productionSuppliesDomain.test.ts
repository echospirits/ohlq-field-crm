import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyLine, lineAvailableQuantity, needCoverage, selectArrival, validateAllocation } from '../lib/productionSupplies/domain';
import { receiptInput } from '../lib/productionSupplies/schemas';

test('specific reviewed SKU rules beat catalog signals; supplier alone never determines production', () => {
  const rules = [{ supplier: 'GFS', sku: 'fixture-raisin', department: 'PRODUCTION', explanation: 'Reviewed ingredient', active: true }];
  assert.equal(classifyLine({ supplier: 'GFS', sku: 'fixture-raisin', rules }).department, 'PRODUCTION');
  assert.equal(classifyLine({ supplier: 'GFS', sku: 'fixture-bar', rules }).department, 'NEEDS_REVIEW');
  assert.equal(classifyLine({ supplier: 'Different', sku: 'fixture-raisin', rules }).department, 'NEEDS_REVIEW');
  assert.equal(classifyLine({ supplier: 'GFS', sku: 'fixture-raisin', rules, manual: { department: 'BAR' } }).department, 'BAR');
});
test('shared use, unknown pack sizes and incompatible units require review', () => {
  const catalog = { id: 'raisins', name: 'Raisins', confirmed: true, departments: ['PRODUCTION'], sharedUse: false, unit: 'lb', packSize: 10 };
  assert.equal(classifyLine({ supplier: 'GFS', catalog, unit: 'case' }).department, 'NEEDS_REVIEW');
  assert.equal(classifyLine({ supplier: 'GFS', catalog, unit: 'lb', packSize: 10 }).department, 'PRODUCTION');
  assert.equal(classifyLine({ supplier: 'GFS', catalog: { ...catalog, sharedUse: true }, unit: 'lb', packSize: 10 }).department, 'NEEDS_REVIEW');
  assert.equal(lineAvailableQuantity({ quantity: 10, department: 'SHARED' }), null);
  assert.equal(lineAvailableQuantity({ quantity: 10, department: 'SHARED', productionQuantity: 4 }), 4);
});
test('coverage never converts units or treats delivery as receipt and resolution', () => {
  const line = { quantity: 10, department: 'PRODUCTION', unit: 'lb', order: { status: 'ORDERED', shipments: [{ status: 'DELIVERED' }] } };
  const need = { quantity: 10, unit: 'lb', allocations: [{ quantity: 5, receivedQuantity: 0, unit: 'lb', line }] };
  assert.deepEqual(needCoverage(need), { required: 10, allocated: 5, received: 0, outstanding: 10, coverage: 'PARTIAL', stage: 'INCOMING', unknown: false });
  assert.equal(needCoverage({ ...need, allocations: [{ ...need.allocations[0], unit: 'case' }] }).coverage, 'UNKNOWN');
  assert.equal(needCoverage({ ...need, allocations: [{ ...need.allocations[0], quantity: 10, receivedQuantity: 10 }] }).stage, 'RECEIVED');
  assert.equal(needCoverage({ ...need, resolvedAt: new Date() }).stage, 'RESOLVED');
  assert.equal(needCoverage({ ...need, allocations: [{ ...need.allocations[0], line: { ...line, order: { status: 'ORDERED', shipments: [{ status: 'RETURNED' }] } } }] }).allocated, 0);
});
test('incoming allocations are bounded and shared quantities remain unknown without an allocation', () => {
  assert.throws(() => validateAllocation({ lineQuantity: 10, alreadyAllocated: 7, quantity: 4, lineUnit: 'lb', needUnit: 'lb', unit: 'lb' }), /already allocated/);
  assert.throws(() => validateAllocation({ lineQuantity: 10, alreadyAllocated: 0, quantity: 1, lineUnit: 'case', needUnit: 'lb', unit: 'lb' }), /matching, known units/);
  assert.doesNotThrow(() => validateAllocation({ lineQuantity: null, alreadyAllocated: 0, quantity: null }));
});
test('date-only arrival precision survives selection without a UTC conversion', () => {
  const eta = { source: 'CARRIER', current: true, startDate: '2026-11-13', observedAt: '2026-11-12T18:00:00Z', precision: 'DATE' };
  assert.equal(selectArrival([eta, { ...eta, source: 'SUPPLIER_PROMISE', startDate: '2026-11-11' }])?.startDate, '2026-11-13');
  assert.equal(selectArrival([{ ...eta, current: false }]), null);
  assert.equal(selectArrival([{ ...eta, source: 'UNRECOGNIZED' }, { ...eta, source: 'APPOINTMENT' }])?.source, 'APPOINTMENT');
});
test('completed damaged receipts count usable received quantities rather than the original promise', () => {
  const need = { quantity: 10, unit: 'lb', allocations: [{ id: 'a', quantity: 10, receivedQuantity: 8, unit: 'lb', line: { id: 'line', quantity: 10, department: 'PRODUCTION', unit: 'lb', order: { status: 'RECEIVED', shipments: [{ status: 'DELIVERED' }] } } }] };
  assert.equal(needCoverage(need).allocated, 8);
  assert.equal(needCoverage(need).coverage, 'PARTIAL');
  assert.equal(needCoverage(need).outstanding, 2);
});
test('partial and damaged Shared receipts do not invent a department receipt allocation', () => {
  const line = { quantity: 10, productionQuantity: 6, department: 'SHARED', unit: 'lb', order: { status: 'ORDERED' }, receiptLines: [{ quantity: 3, damagedQuantity: 1, unit: 'lb' }] };
  const coverage = needCoverage({ quantity: 6, unit: 'lb', allocations: [{ quantity: 6, receivedQuantity: 0, unit: 'lb', line }] });
  assert.equal(coverage.received, 0); assert.equal(coverage.coverage, 'UNKNOWN');
});
test('cancelled or returned remaining shipments preserve legitimate prior internal receipts', () => {
  for (const status of ['CANCELLED', 'RETURNED']) {
    const line = { quantity: 10, department: 'PRODUCTION', unit: 'lb', order: { status: status === 'CANCELLED' ? 'CANCELLED' : 'ORDERED', shipments: [{ status }] } };
    const coverage = needCoverage({ quantity: 10, unit: 'lb', allocations: [{ quantity: 10, receivedQuantity: 3, unit: 'lb', line }] });
    assert.equal(coverage.allocated, 3); assert.equal(coverage.received, 3); assert.equal(coverage.outstanding, 7); assert.equal(coverage.coverage, 'PARTIAL');
  }
});
test('shortage-only receipts are valid without claiming any units were received', () => {
  const result = receiptInput.parse({ orderId: 'order', idempotencyKey: 'shortage', lines: [{ lineId: 'line', quantity: 0, shortageQuantity: 3, unit: 'lb' }] });
  assert.equal(result.lines[0].quantity, 0);
  assert.throws(() => receiptInput.parse({ orderId: 'order', idempotencyKey: 'empty', lines: [{ lineId: 'line', quantity: 0, unit: 'lb' }] }));
});
