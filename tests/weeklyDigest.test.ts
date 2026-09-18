import assert from 'node:assert/strict';
import test from 'node:test';
import { WeeklyDigestStatus } from '@prisma/client';
import { GET as weeklyDigestCronGET } from '../app/api/cron/weekly-digest/route';
import { getWeeklyDigestWindow, isWeeklyDigestCronSendWindow, renderTenantWeeklyDigestEmail, shouldSkipExistingDigestLog } from '../lib/weeklyDigest';
import { makeTenantDigest } from './fixtures/weeklyDigest';
import { fallbackWeeklyDigestNarrative, generateWeeklyDigestNarrative, parseWeeklyDigestNarrative } from '../lib/weeklyDigestNarrative';

test('fixed calendar week is stable across Friday triggers and following weekdays', () => {
  const first = getWeeklyDigestWindow(new Date('2026-09-18T12:00:00Z'));
  assert.equal(first.pastStart.toISOString(), '2026-09-11T04:00:00.000Z');
  assert.equal(first.pastEnd.toISOString(), '2026-09-18T04:00:00.000Z');
  for (const at of ['2026-09-18T13:42:00Z', '2026-09-22T15:00:00Z']) {
    assert.equal(getWeeklyDigestWindow(new Date(at)).pastEnd.toISOString(), first.pastEnd.toISOString());
  }
  const dst = getWeeklyDigestWindow(new Date('2026-03-13T13:00:00Z'));
  assert.equal(dst.pastStart.toISOString(), '2026-03-06T05:00:00.000Z');
  assert.equal(dst.pastEnd.toISOString(), '2026-03-13T04:00:00.000Z');
});

test('Friday cron respects Eastern daylight saving time', () => {
  assert.equal(isWeeklyDigestCronSendWindow(new Date('2026-01-02T13:00:00Z')), true);
  assert.equal(isWeeklyDigestCronSendWindow(new Date('2026-07-03T13:00:00Z')), true);
  assert.equal(isWeeklyDigestCronSendWindow(new Date('2026-07-03T11:00:00Z')), false);
});

test('tenant brief uses configured branding, sales and escaped evidence in HTML and text', () => {
  const digest = makeTenantDigest('other', 'Other <Distillery>');
  digest.organization.brandPrimaryColor = '#ffffff';
  digest.organization.brandAccentColor = '#ffff00';
  digest.narrative.wins[0].title = '<script>alert(1)</script>';
  const email = renderTenantWeeklyDigestEmail(digest, 'https://crm.example.com');
  assert.match(email.subject, /^Other <Distillery> \| Neat weekly brief/);
  assert.match(email.html, /Other &lt;Distillery&gt;/);
  assert.doesNotMatch(email.html, /<script>|Echo Spirits|Per-user|User digest/);
  assert.match(email.html, /background:#ffffff;color:#142c32/);
  for (const text of ['Retail bottles sold', 'Wholesale bottles sold', '412', '186', 'Big wins', 'Major progress', 'Next week', 'Standardized Brewing']) assert.ok(email.html.includes(text), text);
  for (const text of ['412', '186', 'RISKS', 'NEXT WEEK']) assert.ok(email.text.includes(text), text);
  assert.match(email.html, /https:\/\/crm.example.com\/wholesale\/standardized/);
});

test('missing, partial, empty and AI fallback states never imply a complete zero', () => {
  const digest = makeTenantDigest();
  digest.sales = { ...digest.sales, retailBottles: null, wholesaleBottles: null, status: 'unavailable', coveredDays: 0, throughDate: null };
  digest.evidence = []; digest.metrics = { visitsLogged: 0, completedWork: 0, overdue: 0, unassignedOverdue: 0, upcoming: 0, unassignedUpcoming: 0 };
  digest.narrative = fallbackWeeklyDigestNarrative(digest);
  const missing = renderTenantWeeklyDigestEmail(digest);
  assert.match(missing.text, /Retail bottles sold: Unavailable/);
  assert.match(missing.html, /Summary unavailable this time/);
  digest.sales.status = 'partial'; digest.sales.coveredDays = 5; digest.sales.throughDate = '2026-09-16'; digest.sales.retailBottles = 0;
  assert.match(renderTenantWeeklyDigestEmail(digest).text, /Partial: 5\/7 days imported/);
});

test('narrative validates provenance and length; failures degrade to counts', async () => {
  const digest = makeTenantDigest();
  assert.throws(() => parseWeeklyDigestNarrative({ ...digest.narrative, wins: [{ title: 'Invalid', body: 'Invented', evidenceIds: ['other-tenant'] }] }, digest));
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', APP_ENV: 'test', OPENAI_API_KEY: 'fake-unit-test-key' };
  const result = await generateWeeklyDigestNarrative(digest, { env, fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
    assert.equal(JSON.parse(body.input).tenant, 'Echo Spirits');
    return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(digest.narrative) }] }] }), { status: 200 });
  } });
  assert.equal(result.mode, 'ai');
  for (const response of [new Response('{}', { status: 429 }), new Response('{"status":"incomplete"}'), new Response('{"status":"completed","output":[]}')]) {
    assert.equal((await generateWeeklyDigestNarrative(digest, { env, fetchImpl: async () => response })).mode, 'fallback');
  }
  assert.equal((await generateWeeklyDigestNarrative(digest, { env, fetchImpl: async () => { throw new Error('timeout'); } })).mode, 'fallback');
});

test('successful digest logs are skipped and unauthorized cron calls are rejected', async () => {
  assert.equal(shouldSkipExistingDigestLog({ status: WeeklyDigestStatus.SENT }), true);
  assert.equal(shouldSkipExistingDigestLog({ status: WeeklyDigestStatus.FAILED }), false);
  const response = await weeklyDigestCronGET(new Request('http://localhost/api/cron/weekly-digest', { headers: { authorization: 'Bearer invalid' } }));
  assert.equal(response.status, 401);
});
