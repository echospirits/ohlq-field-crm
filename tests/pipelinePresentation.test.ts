import assert from 'node:assert/strict';
import test from 'node:test';
import { pipelineCommitmentDue, selectPipelineCommitments } from '../app/pipeline/presentation';

const task = (id: string, dueDate: Date | null, agencyId: string | null = null, wholesaleAccountId: string | null = 'restaurant-one') => ({ id, title: id, dueDate, agencyId, wholesaleAccountId });

test('Pipeline surfaces the earliest open commitment including overdue work without mutating scoped rows', () => {
  const items = [task('future', new Date('2026-11-06')), task('unscheduled', null), task('overdue', new Date('2026-11-02')), task('later-overdue', new Date('2026-11-03'))];
  const original = [...items];
  assert.equal(selectPipelineCommitments(items).get('WHOLESALE:restaurant-one')?.id, 'overdue');
  assert.deepEqual(items, original);
  assert.equal(pipelineCommitmentDue(items[2].dueDate, new Date('2026-11-04T17:00:00Z')).overdue, '2 days overdue');
});

test('Pipeline distinguishes unscheduled work, absent work and same-id retail versus restaurant accounts', () => {
  const items = [task('restaurant-unscheduled', null), task('retail-unscheduled', null, 'restaurant-one', null), task('unlinked', new Date('2026-11-01'), null, null)];
  const selected = selectPipelineCommitments(items);
  assert.equal(selected.size, 2);
  assert.equal(selected.get('WHOLESALE:restaurant-one')?.id, 'restaurant-unscheduled');
  assert.equal(selected.get('AGENCY:restaurant-one')?.id, 'retail-unscheduled');
  assert.equal(selected.has('WHOLESALE:no-open-work'), false);
  assert.deepEqual(pipelineCommitmentDue(null), { date: 'Unscheduled', overdue: null });
});

test('Pipeline due labels honor UTC date-only deadlines and the current Eastern calendar day', () => {
  const due = new Date('2026-11-04T00:00:00Z');
  assert.deepEqual(pipelineCommitmentDue(due, new Date('2026-11-05T02:00:00Z')), { date: '11/4/2026', overdue: null });
  assert.equal(pipelineCommitmentDue(due, new Date('2026-11-05T14:00:00Z')).overdue, '1 day overdue');
  assert.equal(selectPipelineCommitments([task('first', due), task('same-day', due)]).get('WHOLESALE:restaurant-one')?.id, 'first');
});
