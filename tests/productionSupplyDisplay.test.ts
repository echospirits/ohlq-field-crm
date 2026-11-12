import assert from 'node:assert/strict';
import test from 'node:test';
import { arrivalText, currentArrival, quantityText, safeReturnTo, shortDate, warningFactsText, warningSourceLabel, ownedGmailSourceUrl, type Arrival } from '../app/production-supplies/display';

const estimate = (source: string, date: string, extra: Partial<Arrival> = {}): Arrival => ({ source, precision: 'DATE', startDate: date, timezone: 'America/Los_Angeles', current: true, observedAt: '2026-11-11T10:00:00Z', sourceEventAt: '2026-11-11T09:00:00Z', ...extra });
test('supply arrival display preserves date-only dates and avoids inventing a time', () => {
  assert.equal(shortDate('2026-11-12'), 'Nov 12, 2026');
  assert.equal(arrivalText(estimate('CARRIER', '2026-11-12')), 'Nov 12, 2026');
  assert.equal(arrivalText(estimate('CARRIER', '2026-11-12', { endDate: '2026-11-14', precision: 'DATE_RANGE' })), 'Nov 12, 2026 – Nov 14, 2026');
  assert.equal(arrivalText(undefined), 'No ETA available');
});
test('carrier updates outrank supplier promises while history and source precision remain intact', () => {
  const original = estimate('SUPPLIER_PROMISE', '2026-11-12');
  const current = estimate('CARRIER', '2026-11-14');
  assert.equal(currentArrival([original, current])?.startDate, '2026-11-14');
  assert.equal(original.startDate, '2026-11-12');
  assert.equal(currentArrival([current, estimate('CARRIER', '2026-11-13', { current: false })])?.startDate, '2026-11-14');
  assert.match(arrivalText(estimate('APPOINTMENT', '2026-11-14', { timeStart: '10:00', timeEnd: '12:00' })), /10:00–12:00 America\/Los_Angeles/);
});
test('unknown quantities stay unknown and supply return context stays within the feature', () => {
  assert.equal(quantityText(null, 'lb'), 'Quantity unknown');
  assert.equal(quantityText(0, 'lb'), '0 lb');
  assert.equal(safeReturnTo('//attacker.example'), '/production-supplies');
  assert.equal(safeReturnTo('/production-supplies?view=review&q=raisins'), '/production-supplies?view=review&q=raisins');
});

test('warning facts retain source quantities and thresholds without treating them as replenishment targets', () => {
  assert.equal(warningFactsText({ reportedQuantity: 901, reportedThreshold: 2000, unit: 'Unit(s)' }), 'Last warning reported 901 Unit(s) · threshold 2,000 Unit(s)');
  assert.equal(warningFactsText({ reportedQuantity: 0, reportedThreshold: 0, unit: 'each' }), 'Last warning reported 0 each · threshold 0 each');
  assert.equal(warningFactsText({ reportedQuantity: null, reportedThreshold: 500 }), 'Last warning threshold 500');
  assert.equal(warningFactsText({ reportedQuantity: 1.25, reportedThreshold: null, unit: 'lb' }), 'Last warning reported 1.25 lb');
  assert.equal(warningFactsText({ reportedQuantity: null, reportedThreshold: null }), null);
  assert.equal(warningSourceLabel('DISTILLX5_EMAIL'), 'Distillx5 email');
});

test('original Gmail links support one-time connector sources only for the mailbox owner', () => {
  const viewer = { id: 'joe', email: 'joe+operations@example.test' };
  const source = { provider: 'GOOGLE_CONNECTOR', userId: 'joe', messageId: 'raw/message+id' };
  assert.equal(ownedGmailSourceUrl(source, viewer), 'https://mail.google.com/mail/?authuser=joe%2Boperations%40example.test#all/raw%2Fmessage%2Bid');
  assert.equal(ownedGmailSourceUrl({ ...source, provider: 'GOOGLE' }, viewer), ownedGmailSourceUrl(source, viewer));
  assert.equal(ownedGmailSourceUrl({ ...source, userId: 'other-mailbox-owner' }, viewer), null);
  assert.equal(ownedGmailSourceUrl({ ...source, userId: null }, viewer), null);
  assert.equal(ownedGmailSourceUrl({ ...source, provider: 'MICROSOFT' }, viewer), null);
  assert.equal(ownedGmailSourceUrl({ ...source, provider: 'OTHER_GOOGLE_PROVIDER' }, viewer), null);
});
