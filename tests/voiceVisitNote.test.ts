import assert from 'node:assert/strict';
import test from 'node:test';
import { POST as structureNotePOST } from '../app/api/visits/structure-note/route';
import { structureVisitTranscript, VoiceVisitNoteRequestSchema } from '../lib/voiceVisitNote';
import { buildVisitFieldsFromStructuredNote, getSelectedVoiceFollowUps } from '../lib/voiceVisitNoteShared';

const sampleTranscript =
  "Met with Sara the bar manager. Discussed Echo Vodka and Echo Rye for the summer cocktail menu. They are interested in a menu feature, but price was a concern because they currently pour Tito's. Follow up next Tuesday with samples and a menu idea. Sara prefers morning texts.";

test('voice note structure route rejects unauthenticated requests', async () => {
  const response = await structureNotePOST(
    new Request('http://localhost/api/visits/structure-note', {
      body: JSON.stringify({ transcript: sampleTranscript, visitType: 'wholesale' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  );

  assert.equal(response.status, 401);
});

test('voice note request validation rejects empty transcripts', () => {
  const parsed = VoiceVisitNoteRequestSchema.safeParse({ transcript: '', visitType: 'wholesale' });

  assert.equal(parsed.success, false);
});

test('voice note request validation accepts nullable account context from mobile selection', () => {
  const parsed = VoiceVisitNoteRequestSchema.safeParse({
    accountContext: {
      city: null,
      id: 'account-1',
      identifier: null,
      name: 'The Pearl',
      phone: null,
    },
    timezone: 'America/New_York',
    transcript: sampleTranscript,
    visitType: 'wholesale',
  });

  assert.equal(parsed.success, true);
});

test('deterministic voice note parser returns the structured visit shape', () => {
  const note = structureVisitTranscript({
    accountName: 'The Pearl',
    now: new Date('2026-05-27T16:00:00.000Z'),
    timezone: 'America/New_York',
    transcript: sampleTranscript,
    visitType: 'wholesale',
  });

  assert.match(note.summary, /^The Pearl:/);
  assert.equal(note.contactName, 'Sara');
  assert.equal(note.contactRole, 'Bar Manager');
  assert.ok(note.productsDiscussed.includes('Echo Vodka'));
  assert.ok(note.opportunities.some((opportunity) => /menu feature/i.test(opportunity)));
  assert.ok(note.objections.some((objection) => /price/i.test(objection)));
  assert.ok(note.competitorMentions.some((competitor) => /Tito/i.test(competitor)));
  assert.equal(note.suggestedFollowUps[0]?.dueDate, '2026-06-02');
  assert.match(note.suggestedAccountUpdates.preferredContactTime ?? '', /morning/i);
});

test('edited structured fields are what get mapped into visit form fields', () => {
  const note = structureVisitTranscript({
    now: new Date('2026-05-27T16:00:00.000Z'),
    timezone: 'America/New_York',
    transcript: sampleTranscript,
    visitType: 'wholesale',
  });
  const edited = {
    ...note,
    nextStep: 'Edited next step',
    productsDiscussed: ['Edited product'],
    summary: 'Edited summary',
  };
  const fields = buildVisitFieldsFromStructuredNote(edited);

  assert.equal(fields.summary, 'Edited summary');
  assert.equal(fields.nextStep, 'Edited next step');
  assert.match(fields.outcomes, /Edited product/);
});

test('selected voice follow-up creates a worklist-ready item', () => {
  const formData = new FormData();
  formData.append('voiceFollowUpSelected', '0');
  formData.append('voiceFollowUpTitle', 'Send menu idea');
  formData.append('voiceFollowUpDescription', 'Attach the Echo cocktail build.');
  formData.append('voiceFollowUpDueDate', '2026-06-02');
  formData.append('voiceFollowUpDueDateLabel', 'next Tuesday');

  const followUps = getSelectedVoiceFollowUps(formData);

  assert.equal(followUps.length, 1);
  assert.equal(followUps[0].title, 'Send menu idea');
  assert.equal(followUps[0].dueDate?.toISOString().slice(0, 10), '2026-06-02');
});

test('unselected voice follow-up does not create a worklist-ready item', () => {
  const formData = new FormData();
  formData.append('voiceFollowUpTitle', 'Send menu idea');
  formData.append('voiceFollowUpDescription', 'Attach the Echo cocktail build.');
  formData.append('voiceFollowUpDueDate', '2026-06-02');

  assert.deepEqual(getSelectedVoiceFollowUps(formData), []);
});

test('account update suggestions remain review-only visit note content', () => {
  const note = structureVisitTranscript({
    now: new Date('2026-05-27T16:00:00.000Z'),
    timezone: 'America/New_York',
    transcript: sampleTranscript,
    visitType: 'wholesale',
  });
  const fields = buildVisitFieldsFromStructuredNote(note);

  assert.match(fields.outcomes, /Suggested account updates to review/);
  assert.deepEqual(getSelectedVoiceFollowUps(new FormData()), []);
});
