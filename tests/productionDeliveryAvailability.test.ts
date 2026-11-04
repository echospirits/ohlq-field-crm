import assert from 'node:assert/strict';
import test from 'node:test';
import { businessLeadDays, calendarLeadDays, dateInTimezone, deliveryBaseline } from '../lib/productionForecasting/operationalSignals/delivery';
import { OpenDockReadClient } from '../lib/productionForecasting/operationalSignals/opendock';
import type { DeliveryHistoryObservation, OpenDockLocationConfig, OperatingCalendar } from '../lib/productionForecasting/operationalSignals/types';

const observedAt = '2026-11-03T11:00:00.000Z';
const credentials = { email: 'authorized@example.test', password: 'fake-test-password-must-never-appear-in-results' };
const token = 'testheader.testpayload.testsignature';
const gpt: OpenDockLocationConfig = { market: 'OH', locationCode: 'GPT', locationName: 'Test GPT', warehouseId: '11111111-1111-4111-8111-111111111111', loadTypeId: '22222222-2222-4222-8222-222222222222', timezone: 'America/New_York' };
const grn: OpenDockLocationConfig = { ...gpt, locationCode: 'GRN', locationName: 'Test GRN', warehouseId: '33333333-3333-4333-8333-333333333333' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const slots = (...values: string[]) => json({ data: [{ availability: [], startTimes: values }] });
type RequestHandler = (url: URL, init: RequestInit) => Response | Promise<Response>;
function mock(handler: RequestHandler): typeof fetch {
  return (async (input, init) => handler(new URL(String(input)), init ?? {})) as typeof fetch;
}
const noWait = async () => {};
function history(from: string, length: number, lead = 5): DeliveryHistoryObservation[] {
  return Array.from({ length }, (_, i) => ({ observedAt: new Date(Date.parse(from + 'T12:00:00Z') + i * 86_400_000).toISOString(), calendarDays: lead, status: 'SUCCESS' }));
}

test('source calendar dates give correct lead time across DST, UTC midnight, and same-day slots', () => {
  assert.equal(calendarLeadDays('2026-11-01T00:30:00-04:00', '2026-11-02T00:05:00-05:00', gpt.timezone), 1);
  assert.equal(calendarLeadDays('2026-03-08T00:30:00-05:00', '2026-03-09T00:05:00-04:00', gpt.timezone), 1);
  assert.equal(calendarLeadDays('2026-11-04T00:30:00Z', '2026-11-04T06:00:00Z', gpt.timezone), 1);
  assert.equal(calendarLeadDays(observedAt, '2026-11-03T20:00:00Z', gpt.timezone), 0);
  assert.equal(dateInTimezone('2026-11-04T00:30:00Z', gpt.timezone), '2026-11-03');
  assert.throws(() => calendarLeadDays(observedAt, '2026-11-03T10:00:00Z', gpt.timezone));
});

test('business days require an explicit complete source calendar and respect closures without assuming fully booked days closed', () => {
  const calendar: OperatingCalendar = { coveredFrom: '2026-11-01', coveredThrough: '2026-11-30', openWeekdays: [1, 2, 3, 4, 5], closedDates: ['2026-11-16'] };
  const from = '2026-11-13T12:00:00Z', through = '2026-11-17T12:00:00Z';
  assert.equal(calendarLeadDays(from, through, gpt.timezone), 4);
  assert.equal(businessLeadDays(from, through, gpt.timezone, calendar), 1);
  assert.equal(businessLeadDays(from, through, gpt.timezone, { ...calendar, closedDates: [] }), 2);
  assert.equal(businessLeadDays(from, through, gpt.timezone), null);
  assert.equal(businessLeadDays(from, through, gpt.timezone, { ...calendar, coveredThrough: '2026-11-16' }), null);
  assert.equal(businessLeadDays(from, '2026-11-16T12:00:00Z', gpt.timezone, calendar), null);
  assert.equal(businessLeadDays(from, through, gpt.timezone, { ...calendar, closedDates: ['2026-02-30'] }), null);
});

test('seasonal baseline uses distinct prior-year days, transparent tolerance, and all three classifications', () => {
  const past = [...history('2025-10-20', 14), ...history('2026-05-01', 30, 50)];
  const result = deliveryBaseline(past, observedAt, 7, gpt.timezone);
  assert.deepEqual(result, { stage: 'PRIOR_YEAR_SEASONAL', classification: 'More than average', typicalDays: 5, sampleDays: 14, toleranceDays: 1 });
  assert.equal(deliveryBaseline(past, observedAt, 6, gpt.timezone).classification, 'About average');
  assert.equal(deliveryBaseline(past, observedAt, 3, gpt.timezone).classification, 'Less than average');
  assert.equal(deliveryBaseline(history('2025-10-20', 14, 10), observedAt, 12, gpt.timezone).classification, 'About average');
});

test('baseline falls back through nearby calendar history, trailing90, then insufficient history', () => {
  assert.equal(deliveryBaseline(history('2026-10-20', 14), observedAt, 5, gpt.timezone).stage, 'NEARBY_CALENDAR_PERIOD');
  assert.equal(deliveryBaseline(history('2026-09-04', 14), observedAt, 5, gpt.timezone).stage, 'TRAILING_90_DAYS');
  const missing = deliveryBaseline(history('2026-09-04', 13), observedAt, 5, gpt.timezone);
  assert.equal(missing.stage, 'INSUFFICIENT_HISTORY'); assert.equal(missing.typicalDays, null); assert.equal(missing.classification, null);
  assert.equal(deliveryBaseline(history('2026-10-20', 14), observedAt, null, gpt.timezone).classification, null);
});

test('baseline excludes today, future, failures, nulls and duplicate days, and selects latest successful observation for a day', () => {
  const past = history('2026-10-20', 14);
  const noise: DeliveryHistoryObservation[] = [
    { observedAt, calendarDays: 999, status: 'SUCCESS' },
    { observedAt: '2027-01-01T12:00:00Z', calendarDays: 999, status: 'SUCCESS' },
    { observedAt: '2026-10-19T12:00:00Z', calendarDays: 999, status: 'UNAVAILABLE' },
    { observedAt: '2026-10-19T12:00:00Z', calendarDays: null, status: 'SUCCESS' },
    ...past.map(value => ({ ...value })),
    { observedAt: '2026-10-20T15:00:00Z', calendarDays: 19, status: 'SUCCESS' },
  ];
  const result = deliveryBaseline([...past, ...noise], observedAt, 6, gpt.timezone);
  assert.equal(result.sampleDays, 14); assert.equal(result.typicalDays, 6);
  const singleDay = Array.from({ length: 20 }, () => past[0]);
  assert.equal(deliveryBaseline(singleDay, observedAt, 3, gpt.timezone).stage, 'INSUFFICIENT_HISTORY');
});

test('seasonal matching crosses year boundaries and does not call last December a prior-year seasonal history', () => {
  const winter = history('2025-12-20', 14, 4);
  assert.equal(deliveryBaseline(winter, '2027-01-03T12:00:00Z', 5, gpt.timezone).stage, 'PRIOR_YEAR_SEASONAL');
  assert.equal(deliveryBaseline(winter, '2026-01-03T12:00:00Z', 5, gpt.timezone).stage, 'NEARBY_CALENDAR_PERIOD');
  assert.equal(deliveryBaseline(history('2027-02-15', 14), '2028-02-29T12:00:00Z', 5, gpt.timezone).stage, 'PRIOR_YEAR_SEASONAL');
});

test('GPT and GRN stay separate and earliest usable source slot wins regardless of order or duplicates', async () => {
  const request = mock((url, init) => {
    assert.equal(url.origin, 'https://neutron.opendock.com'); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    if (url.pathname === '/auth/login') return json({ access_token: token });
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + token);
    const warehouse = JSON.parse(String(init.body)).warehouseId;
    return warehouse === gpt.warehouseId
      ? slots('2026-11-06T14:00:00Z', '2026-11-04T13:00:00-05:00', '2026-11-04T13:00:00-05:00', '2026-11-03T10:00:00Z')
      : slots('2026-11-06T14:00:00Z');
  });
  const client = new OpenDockReadClient(credentials, { request, sleep: noWait });
  const a = await client.availability(gpt, observedAt), b = await client.availability(grn, observedAt);
  assert.equal(a.status, 'SUCCESS'); assert.equal(a.locationCode, 'GPT'); assert.equal(a.earliestAvailableAt, '2026-11-04T13:00:00-05:00'); assert.equal(a.calendarDays, 1);
  assert.equal(b.status, 'SUCCESS'); assert.equal(b.locationCode, 'GRN'); assert.equal(b.calendarDays, 3);
  assert.equal(a.businessDays, null); assert.equal(a.businessDayMethod, null);
  assert.ok(!JSON.stringify([a, b, client]).includes(credentials.password)); assert.ok(!JSON.stringify([a, b, client]).includes(token));
});

test('availability pages bounded time windows to find a later slot and retains searched-through boundary', async () => {
  const windows: { start: string; end: string }[] = [];
  const request = mock((url, init) => {
    if (url.pathname === '/auth/login') return json({ access_token: token });
    const body = JSON.parse(String(init.body)); windows.push(body);
    return windows.length < 3 ? slots() : slots(new Date(Date.parse(body.start) + 3_600_000).toISOString());
  });
  const result = await new OpenDockReadClient(credentials, { request, sleep: noWait }).availability(gpt, observedAt);
  assert.equal(result.status, 'SUCCESS'); assert.equal(windows.length, 3); assert.equal(result.calendarDays, 14);
  assert.equal(windows[1].start, windows[0].end); assert.equal(result.checkedThrough, windows[2].end);
});

test('no appointments within the 90-day checked range is not zero lead time or a retrieval failure', async () => {
  let count = 0;
  const request = mock(url => url.pathname === '/auth/login' ? json({ access_token: token }) : (count++, slots()));
  const result = await new OpenDockReadClient(credentials, { request, sleep: noWait }).availability(gpt, observedAt);
  assert.equal(count, 13); assert.equal(result.status, 'NO_AVAILABILITY');
  assert.equal(result.earliestAvailableAt, null); assert.equal(result.calendarDays, null); assert.equal(result.businessDays, null);
  assert.equal(result.checkedThrough, new Date(Date.parse(observedAt) + 90 * 86_400_000).toISOString());
});

test('authentication failure returns a safe status with no password, response body, or zero demand/lead values', async () => {
  let attempts = 0;
  const request = mock(() => { attempts++; return json({ message: credentials.password }, 401); });
  const result = await new OpenDockReadClient(credentials, { request, sleep: noWait }).availability(gpt, observedAt);
  assert.equal(attempts, 1); assert.equal(result.status, 'AUTH_FAILED'); assert.equal(result.calendarDays, null);
  assert.ok(!JSON.stringify(result).includes(credentials.password)); assert.equal(result.checkedThrough, null);
});

test('expired sessions reauthenticate once and do not loop on repeated failure', async () => {
  for (const recover of [true, false]) {
    let logins = 0, searches = 0;
    const request = mock(url => {
      if (url.pathname === '/auth/login') { logins++; return json({ access_token: token }); }
      searches++;
      return searches === 1 || !recover ? json({ message: 'Expired' }, 401) : slots('2026-11-04T12:00:00Z');
    });
    const result = await new OpenDockReadClient(credentials, { request, sleep: noWait }).availability(gpt, observedAt);
    assert.equal(logins, 2); assert.equal(searches, 2); assert.equal(result.status, recover ? 'SUCCESS' : 'AUTH_FAILED');
  }
});

test('temporary source errors retry with bounded backoff while network exceptions remain sanitized', async () => {
  let calls = 0; const delays: number[] = [];
  const request = mock(url => {
    if (url.pathname === '/auth/login') return json({ access_token: token });
    calls++; return calls === 1 ? json({ private: credentials.password }, 503) : slots('2026-11-04T12:00:00Z');
  });
  const success = await new OpenDockReadClient(credentials, { request, sleep: async value => { delays.push(value); } }).availability(gpt, observedAt);
  assert.equal(success.status, 'SUCCESS'); assert.equal(calls, 2); assert.deepEqual(delays, [250]);
  let failedCalls = 0;
  const failure = await new OpenDockReadClient(credentials, { request: mock(() => { failedCalls++; throw Error(credentials.password); }), sleep: noWait }).availability(gpt, observedAt);
  assert.equal(failedCalls, 3); assert.equal(failure.status, 'UNAVAILABLE'); assert.ok(!JSON.stringify(failure).includes(credentials.password));
});

test('redirects, non-JSON portal pages and changed slot structure are rejected without inventing availability', async () => {
  const badResponses = [
    () => new Response('', { status: 302, headers: { location: 'https://untrusted.example.test' } }),
    () => new Response('<html>' + credentials.password + '</html>', { headers: { 'content-type': 'text/html' } }),
    () => json({ data: [{ availability: [{ start: '2026-11-04T12:00:00Z', end: '2026-11-04T13:00:00Z' }] }] }),
    () => slots('2026-02-30T12:00:00Z'),
    () => slots('2026-11-04T12:00:00'),
  ];
  for (const bad of badResponses) {
    const request = mock(url => url.pathname === '/auth/login' ? json({ access_token: token }) : bad());
    const result = await new OpenDockReadClient(credentials, { request, sleep: noWait }).availability(gpt, observedAt);
    assert.equal(result.status, 'INVALID_RESPONSE'); assert.equal(result.calendarDays, null); assert.equal(result.earliestAvailableAt, null);
    assert.ok(!JSON.stringify(result).includes(credentials.password));
  }
});

test('unconfirmed or path-injected facility identifiers and invalid timezones never cause an authenticated request', async () => {
  let calls = 0;
  const request = mock(() => { calls++; return json({ access_token: token }); });
  const client = new OpenDockReadClient(credentials, { request, sleep: noWait });
  for (const location of [{ ...gpt, warehouseId: '' }, { ...gpt, loadTypeId: '../appointment' }, { ...gpt, timezone: 'Not/A_Timezone' }]) {
    const result = await client.availability(location, observedAt);
    assert.equal(result.status, 'NOT_CONFIGURED'); assert.equal(result.calendarDays, null);
  }
  assert.equal(calls, 0);
});

test('one warehouse failure cannot turn a successful observation for the other into missing or zero', async () => {
  const request = mock((url, init) => {
    if (url.pathname === '/auth/login') return json({ access_token: token });
    return JSON.parse(String(init.body)).warehouseId === gpt.warehouseId ? slots('2026-11-04T12:00:00Z') : json({ message: 'Forbidden' }, 403);
  });
  const client = new OpenDockReadClient(credentials, { request, sleep: noWait });
  const [a, b] = await Promise.all([client.availability(gpt, observedAt), client.availability(grn, observedAt)]);
  assert.equal(a.status, 'SUCCESS'); assert.equal(a.calendarDays, 1);
  assert.equal(b.status, 'AUTH_FAILED'); assert.equal(b.calendarDays, null);
});
test('load-type discovery validates every page and warehouse and returns only safe inbound identifiers', async () => {
  const ltlId = '44444444-4444-4444-8444-444444444444';
  const ftlId = '55555555-5555-4555-8555-555555555555';
  const calls: string[] = [];
  const request = mock((url, init) => {
    if (url.pathname === '/auth/login') return json({ access_token: token });
    assert.equal(url.origin, 'https://neutron.opendock.com'); assert.equal(url.pathname, '/loadtype');
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.redirect, 'error');
    assert.equal(url.searchParams.get('showOnlyAssignedLoadTypes'), 'true');
    assert.deepEqual(JSON.parse(url.searchParams.get('s')!), { allowCarrierScheduling: true });
    const warehouseId = url.searchParams.get('warehouseId')!, page = Number(url.searchParams.get('page'));
    calls.push(warehouseId + ':' + page);
    const gptFirst = warehouseId === gpt.warehouseId && page === 1;
    const row = { id: gptFirst ? ftlId : ltlId, name: gptFirst ? 'FTL - Pallet Load' : 'LTL - Pallet Load',
      warehouseId: warehouseId === grn.warehouseId ? null : warehouseId,
      direction: gptFirst ? 'Outbound' : 'Inbound', allowCarrierScheduling: true, secretMetadata: credentials.password };
    return json({ data: [row], page, pageCount: warehouseId === gpt.warehouseId ? 2 : 1, count: 1, total: warehouseId === gpt.warehouseId ? 2 : 1 });
  });
  const result = await new OpenDockReadClient(credentials, { request, sleep: noWait }).discoverLoadTypes([gpt.warehouseId, grn.warehouseId]);
  assert.equal(result.status, 'SUCCESS');
  assert.deepEqual(result.loadTypes, [
    { warehouseId: gpt.warehouseId, id: ltlId, name: 'LTL - Pallet Load' },
    { warehouseId: grn.warehouseId, id: ltlId, name: 'LTL - Pallet Load' },
  ]);
  assert.deepEqual(calls, [gpt.warehouseId + ':1', gpt.warehouseId + ':2', grn.warehouseId + ':1']);
  assert.ok(!JSON.stringify(result).includes(credentials.password)); assert.ok(!JSON.stringify(result).includes(token));
});

test('load-type discovery discards partial results when pagination, warehouse ownership, or required source fields change', async () => {
  const row = { id: gpt.loadTypeId, name: 'LTL - Pallet Load', warehouseId: gpt.warehouseId, direction: 'Inbound', allowCarrierScheduling: true };
  const responses = [
    { data: [row], count: 1, total: 1 },
    { data: [row], count: 2, total: 1, page: 1, pageCount: 1 },
    { data: [{ ...row, warehouseId: grn.warehouseId }], count: 1, total: 1, page: 1, pageCount: 1 },
    { data: [{ ...row, direction: undefined }], count: 1, total: 1, page: 1, pageCount: 1 },
    { data: [row], count: 1, total: 1, page: 1, pageCount: 0 },
  ];
  for (const response of responses) {
    const request = mock(url => url.pathname === '/auth/login' ? json({ access_token: token }) : json(response));
    const result = await new OpenDockReadClient(credentials, { request, sleep: noWait }).discoverLoadTypes([gpt.warehouseId]);
    assert.equal(result.status, 'INVALID_RESPONSE'); assert.deepEqual(result.loadTypes, []);
  }
  let page = 0;
  const duplicateRequest = mock(url => url.pathname === '/auth/login' ? json({ access_token: token }) : json({ data: [row], count: 1, total: 2, page: ++page, pageCount: 2 }));
  const duplicate = await new OpenDockReadClient(credentials, { request: duplicateRequest, sleep: noWait }).discoverLoadTypes([gpt.warehouseId]);
  assert.equal(duplicate.status, 'INVALID_RESPONSE'); assert.deepEqual(duplicate.loadTypes, []);
});

test('load-type discovery renews an expired session only once, supports an explicit empty list, and refuses injected IDs', async () => {
  let logins = 0, searches = 0;
  const request = mock(url => {
    if (url.pathname === '/auth/login') { logins++; return json({ access_token: token }); }
    searches++; return searches === 1 ? json({}, 401) : json({ data: [], count: 0, total: 0, page: 1, pageCount: 0 });
  });
  const result = await new OpenDockReadClient(credentials, { request, sleep: noWait }).discoverLoadTypes([gpt.warehouseId]);
  assert.equal(result.status, 'SUCCESS'); assert.deepEqual(result.loadTypes, []); assert.equal(logins, 2); assert.equal(searches, 2);
  let invalidCalls = 0;
  const rejected = await new OpenDockReadClient(credentials, { request: mock(() => { invalidCalls++; return json({}); }) }).discoverLoadTypes(['../appointment']);
  assert.equal(rejected.status, 'NOT_CONFIGURED'); assert.equal(invalidCalls, 0);
});