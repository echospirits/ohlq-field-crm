import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addEasternCalendarDays,
  formatDateOnly,
  formatEasternDate,
  formatEasternDateInputValue,
  formatEasternDateTime,
} from '../lib/dateTime';

test('timestamp formatting renders Eastern time with DST label', () => {
  assert.equal(formatEasternDateTime(new Date('2026-06-02T16:30:00.000Z')), 'Jun 2, 2026, 12:30 PM EDT');
  assert.equal(formatEasternDateTime(new Date('2026-01-02T13:00:00.000Z')), 'Jan 2, 2026, 8:00 AM EST');
});

test('date-only formatting does not shift midnight UTC values into the previous Eastern day', () => {
  const dateOnlyValue = new Date('2026-06-02T00:00:00.000Z');

  assert.equal(formatDateOnly(dateOnlyValue), '6/2/2026');
  assert.equal(formatEasternDate(dateOnlyValue), '6/1/2026');
});

test('Eastern date input defaults use the Eastern calendar day', () => {
  assert.equal(formatEasternDateInputValue(new Date('2026-06-02T01:30:00.000Z')), '2026-06-01');
  assert.equal(addEasternCalendarDays(1, new Date('2026-06-02T01:30:00.000Z')), '2026-06-02');
});
