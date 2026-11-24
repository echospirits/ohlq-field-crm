import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/visits/timing/route';
import { isSampledVisitTimingId } from '../lib/visitTiming';

const sampleId = '07000000-0000-4000-8000-000000000000';
const payload = { id: sampleId, action: 'save', outcome: 'success', elapsedMs: 410, responseMs: 25 };

function request(body: unknown, origin = 'https://neat.example', fetchSite?: string) {
  const text = JSON.stringify(body);
  return new NextRequest('https://neat.example/api/visits/timing', {
    method: 'POST',
    body: text,
    headers: {
      origin, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)),
      ...(fetchSite ? { 'sec-fetch-site': fetchSite } : {}),
    },
  });
}

test('timing correlation accepts only sampled version 4 UUIDs', () => {
  assert.equal(isSampledVisitTimingId(sampleId), true);
  assert.equal(isSampledVisitTimingId('08000000-0000-4000-8000-000000000000'), false);
  assert.equal(isSampledVisitTimingId('07000000-0000-5000-8000-000000000000'), false);
  assert.equal(isSampledVisitTimingId('an account name'), false);
});

test('visit timing rejects foreign origins or records with arbitrary text and impossible durations', async () => {
  assert.equal((await POST(request(payload, 'https://elsewhere.example'))).status, 403);
  assert.equal((await POST(request(payload, 'https://elsewhere.neat.example', 'same-site'))).status, 403);
  assert.equal((await POST(request(payload, 'https://neat.example', 'cross-site'))).status, 403);
  assert.equal((await POST(request({ ...payload, notes: 'arbitrary text' }, 'https://public.neat.example', 'same-origin'))).status, 400);
  assert.equal((await POST(request({ ...payload, notes: 'arbitrary text' }))).status, 400);
  assert.equal((await POST(request({ ...payload, responseMs: 411 }))).status, 400);
  assert.equal((await POST(request({ ...payload, elapsedMs: 181_000 }))).status, 400);
});
