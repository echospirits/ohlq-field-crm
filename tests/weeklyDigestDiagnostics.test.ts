import assert from 'node:assert/strict';
import test from 'node:test';
import { generateWeeklyDigestNarrative } from '../lib/weeklyDigestNarrative';
import { makeTenantDigest } from './fixtures/weeklyDigest';

test('citation choices are scoped to each request, including empty and maximum-size weeks', async () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', APP_ENV: 'test', OPENAI_API_KEY: 'fake-unit-test-key' };
  for (const count of [29, 0, 600, 1]) {
    const input = makeTenantDigest();
    const sample = input.evidence[0];
    input.evidence = Array.from({ length: count }, (_, index) => ({ ...sample, id: `visit:tenant-${count}-${String(index).padStart(30, '0')}` }));
    let checked = false;
    const result = await generateWeeklyDigestNarrative(input, { env, fetchImpl: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const schema = request.text.format.schema;
      assert.equal(request.text.format.strict, true);
      const groups: Array<{ type: string; enum: string[] }> = schema.$defs.evidenceId.anyOf;
      const ids = groups.flatMap((group) => group.enum);
      assert.deepEqual(ids, ['metrics', 'sales', ...input.evidence.map((item) => item.id)]);
      assert.ok(groups.every((group) => group.type === 'string' && group.enum.length <= 200));
      assert.ok(ids.length <= 1000);
      assert.ok(!ids.includes('visit:another-tenant'));
      for (const section of ['wins', 'progress', 'risks', 'nextWeek']) {
        assert.deepEqual(schema.properties[section].items, { $ref: '#/$defs/highlight' });
      }
      assert.deepEqual(schema.$defs.highlight.properties.evidenceIds.items, { $ref: '#/$defs/evidenceId' });
      checked = true;
      return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ headline: 'Brief', wins: [], progress: [{ title: 'Activity', body: 'Recorded activity.', evidenceIds: [ids.at(-1)] }], risks: [], nextWeek: [] }) }] }] }));
    } });
    assert.ok(checked);
    assert.equal(result.mode, 'ai');
  }
});

test('summary diagnostics classify failures without logging tenant content or credentials', async (t) => {
  const entries: Array<{ event: string; details: Record<string, unknown> }> = [];
  t.mock.method(console, 'warn', (event: string, details: Record<string, unknown>) => entries.push({ event, details }));
  t.mock.method(console, 'info', (event: string, details: Record<string, unknown>) => entries.push({ event, details }));
  const secret = 'PRIVATE_TENANT_CONTENT_AND_KEY';
  const input = makeTenantDigest();
  input.organization.displayName = secret;
  input.evidence[0].text = secret;
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', APP_ENV: 'test', OPENAI_API_KEY: secret };
  const completed = (value: unknown) => new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }));
  const cases: Array<[string, () => Promise<Response>]> = [
    ['api_error', async () => new Response(JSON.stringify({ error: { code: 'insufficient_quota', type: secret, message: secret } }), { status: 429, headers: { 'x-request-id': 'req_safe123' } })],
    ['timeout', async () => { throw new DOMException(secret, 'TimeoutError'); }],
    ['transport_error', async () => { throw new Error(secret); }],
    ['incomplete_response', async () => new Response(JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }))],
    ['invalid_json', async () => new Response(secret)],
    ['empty_output', async () => new Response('{"status":"completed","output":[]}')],
    ['refusal', async () => new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'refusal', refusal: secret }] }] }))],
    ['schema_validation', async () => completed({ ...input.narrative, headline: secret.repeat(20) })],
    ['unknown_evidence', async () => completed({ ...input.narrative, wins: [{ title: 'Win', body: secret, evidenceIds: [secret] }] })],
    ['word_limit', async () => completed({ headline: 'Brief', wins: [], progress: [], risks: Array.from({ length: 3 }, () => ({ title: 'Risk', body: 'a '.repeat(160), evidenceIds: ['metrics'] })), nextWeek: [] })],
  ];
  for (const [reason, fetchImpl] of cases) {
    const result = await generateWeeklyDigestNarrative(input, { env, fetchImpl });
    assert.equal(result.mode, 'fallback');
    const logged = entries.at(-1)!;
    assert.equal(logged.event, 'weekly-digest.summary-fallback');
    assert.equal(logged.details.reason, reason);
    assert.equal(typeof logged.details.elapsedMs, 'number');
  }
  assert.equal(entries[0].details.httpStatus, 429);
  assert.equal(entries[0].details.providerCode, 'insufficient_quota');
  assert.equal(entries[0].details.providerType, 'other');
  assert.equal(entries[0].details.requestId, 'req_safe123');
  assert.equal(entries[3].details.incompleteReason, 'max_output_tokens');
  assert.deepEqual(entries[7].details.validationIssues, [{ code: 'too_big', path: 'headline' }]);
  for (const [overrides, reason] of [[{ OPENAI_API_KEY: '' }, 'missing_api_key'], [{ WEEKLY_DIGEST_AI_ENABLED: 'false' }, 'ai_disabled']] as const) {
    await generateWeeklyDigestNarrative(input, { env: { ...env, ...overrides }, fetchImpl: async () => { throw new Error('Must not call API'); } });
    assert.equal(entries.at(-1)!.details.reason, reason);
  }
  assert.equal((await generateWeeklyDigestNarrative(input, { env, fetchImpl: async () => completed(input.narrative) })).mode, 'ai');
  assert.equal(entries.at(-1)!.event, 'weekly-digest.summary-completed');
  assert.ok(!JSON.stringify(entries).includes(secret));
});
