import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isValidZonedDateTime, zonedDateTimeToUtc } from '../dateTime';
import { SupplyTrackingError, type NormalizedTrackingObservation, type TrackingEnvironment, type TrackingReference } from './trackingTypes';

const WARD_TRACE_URL = 'https://wardtlctools.com/wardtrucking/webservices/traceshipmentv3';
const wardCarriers = new Set(['ward', 'wardtlc', 'wardtrucking', 'wardtruckingllc', 'wardtruckingllcward', 'wardtransportlogistics', 'wardtransportandlogistics']);
const zipPattern = /\b(\d{5})(?:-\d{4})?\s*(?:,?\s*(?:US|USA))?$/i;

export function isWardFreight(reference: TrackingReference) {
  return ['BILL_OF_LADING', 'FREIGHT_PRO'].includes(reference.referenceType) && wardCarriers.has(reference.carrier?.toLowerCase().replace(/[^a-z]/g, '') || '');
}

export function wardProNumber(value?: string | null) {
  const match = value?.trim().match(/^(\d{3})-?(\d{7})$/);
  return match ? `${match[1]}-${match[2]}` : null;
}

export function wardPostalCode(value?: string | null) {
  return value?.trim().match(zipPattern)?.[1] ?? null;
}

function wardCredentials(organizationId: string, env: TrackingEnvironment) {
  const { SUPPLY_WARD_TRACKING_ENABLED: enabled, SUPPLY_WARD_TRACKING_ORGANIZATION_ID: tenant, SUPPLY_WARD_TRACKING_USERNAME: username, SUPPLY_WARD_TRACKING_PASSWORD: password } = env;
  return enabled === 'true' && tenant?.trim() === organizationId && username?.trim() && password?.trim() ? { username: username.trim(), password } : null;
}

export function isWardTrackingConfigured(organizationId: string, env: TrackingEnvironment = process.env) {
  return Boolean(wardCredentials(organizationId, env));
}

type WardReference = TrackingReference & { originPostalCode?: string | null; proNumber?: string | null; destinationPostalCode?: string | null };
const wardText = z.string().trim().max(500);
const wardHeader = z.object({
  referenceNumber: wardText.min(1), wardPro: wardText.min(1), status: wardText.min(1),
  shipperZip: wardText.nullish(), consigneeZip: wardText.min(1), deliveryDate: wardText.nullish(), dueDate: wardText.nullish(),
});
const wardMovement = z.object({ ref: wardText.min(1), date: wardText, time: wardText, action: wardText.min(1), zip: wardText.nullish() });
const wardResponse = z.object({ result: wardText, Reference: z.union([z.array(z.unknown()).min(1).max(500), wardHeader]) });

function wardDate(value?: string | null) {
  const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const day = `${match[3]}-${match[1]}-${match[2]}`;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
}

function wardStatus(value: string) {
  const status = value.toLowerCase().trim();
  if (/\breturn(?:ed|ing)? to (?:sender|shipper|origin)\b/.test(status)) return 'RETURNED';
  if (/^delivered\.?$|^delivery to\b/.test(status)) return 'DELIVERED';
  if (/^out for delivery\b/.test(status)) return 'OUT_FOR_DELIVERY';
  if (/^cancel(?:led|ed)\b/.test(status)) return 'CANCELLED';
  if (/^delivery attempted\b|^delayed\b|^refused\b/.test(status)) return 'DELAYED';
  if (/^picked up\b|^shipment en route\b|^en\s?route\b|^trailer departed\b|^arrived at\b|^unloaded at\b|^in transit\b/.test(status)) return 'IN_TRANSIT';
  return 'UNKNOWN';
}

function movementTime(date: string | null, time: string, timezone: string | null | undefined) {
  const clock = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s+(AM|PM))?$/i);
  if (!date || !clock || !timezone) return null;
  const hour = Number(clock[1]), minute = Number(clock[2]), second = Number(clock[3] || 0), half = clock[4]?.toUpperCase();
  if (minute > 59 || second > 59 || (half ? hour < 1 || hour > 12 : hour > 23)) return null;
  const hours = half ? hour % 12 + (half === 'PM' ? 12 : 0) : hour;
  const minutes = hours * 60 + minute;
  return isValidZonedDateTime(date, minutes, timezone) ? new Date(zonedDateTimeToUtc(date, minutes, timezone).getTime() + second * 1_000) : null;
}

function normalizedReference(value: string) {
  return value.replace(/\s+/g, '').toUpperCase();
}

function parseWardObservation(value: unknown, reference: WardReference, lookup: { pro: string | null; bol: string | null; origin: string | null; destination: string }, observedAt: Date): NormalizedTrackingObservation {
  const parsed = wardResponse.safeParse(value);
  if (!parsed.success || parsed.data.result.toLowerCase() !== 'success') throw new SupplyTrackingError('Ward did not return a validated shipment.', 'invalid_response');
  const rows = Array.isArray(parsed.data.Reference) ? parsed.data.Reference : [parsed.data.Reference];
  const result = wardHeader.safeParse(rows[0]);
  if (!result.success) throw new SupplyTrackingError('Ward returned an unsupported shipment response.', 'invalid_response');
  const header = result.data;
  const pro = wardProNumber(header.wardPro);
  if (!pro || (lookup.pro ? pro !== lookup.pro || wardProNumber(header.referenceNumber) !== lookup.pro : normalizedReference(header.referenceNumber) !== lookup.bol || wardPostalCode(header.shipperZip) !== lookup.origin)) {
    throw new SupplyTrackingError('Ward returned a different shipment reference.', 'reference_mismatch');
  }
  if (wardPostalCode(header.consigneeZip) !== lookup.destination) throw new SupplyTrackingError('Ward returned a different destination ZIP.', 'destination_mismatch');

  const movements = rows.slice(1).flatMap(row => {
    const match = wardMovement.safeParse(row);
    if (!match.success || wardProNumber(match.data.ref) !== pro) return [];
    const data = match.data;
    const date = wardDate(data.date);
    const atDestination = wardPostalCode(data.zip) === lookup.destination;
    return [{ date, time: data.time, status: wardStatus(data.action), atDestination, exactDelivery: /^delivered\.?$/i.test(data.action), instant: atDestination ? movementTime(date, data.time, reference.timezone) : null }];
  });
  const currentStatus = wardStatus(header.status);
  const returned = currentStatus === 'RETURNED' || movements.some(item => item.status === 'RETURNED') || Boolean(reference.returnedAt);
  const status = returned ? 'RETURNED' : currentStatus;
  // The movement feed gives terminal-local clocks. Only matched destination scans can use the shipment's local timezone.
  const statusMovements = movements.filter(item => item.status === status && item.instant).sort((a, b) => b.instant!.getTime() - a.instant!.getTime());
  const delivery = status === 'DELIVERED' ? statusMovements.find(item => item.exactDelivery) ?? statusMovements[0] : null;
  const deliveredAt = delivery && (!header.deliveryDate || delivery.date === wardDate(header.deliveryDate)) ? delivery.instant : null;
  const eventTime = status === 'DELIVERED' ? deliveredAt : statusMovements[0]?.instant ?? null;
  const dueDate = wardDate(header.dueDate);
  const estimate = dueDate && reference.timezone && ['IN_TRANSIT','OUT_FOR_DELIVERY'].includes(status)
    ? { source: 'CARRIER' as const, precision: 'DATE' as const, startDate: dueDate, endDate: null, timeStart: null, timeEnd: null, timezone: reference.timezone } : null;
  const eventKey = createHash('sha256').update(JSON.stringify({ pro, status, deliveredAt, dueDate, statusMovements: movements.filter(item => item.status === status).map(({ date, time, atDestination }) => ({ date, time, atDestination })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) })).digest('hex');
  return { provider: 'WARD', providerMode: 'production', providerTrackingId: pro, trackingCode: reference.reference, carrier: 'Ward Trucking',
    eventKey, providerEventAt: eventTime ?? observedAt, eventTimeKnown: Boolean(eventTime), observedAt, status, returned, deliveredAt, estimate,
    summary: `Ward reports ${status.toLowerCase().replace(/_/g, ' ')}.` };
}

export async function lookupWardTracking(organizationId: string, reference: WardReference, options: { env?: TrackingEnvironment; fetchImpl?: typeof fetch; observedAt?: Date; timeoutMs?: number } = {}) {
  if (!isWardFreight(reference)) throw new SupplyTrackingError('Ward tracking requires a Ward freight reference.', 'unsupported_reference');
  const credentials = wardCredentials(organizationId, options.env ?? process.env);
  if (!credentials) throw new SupplyTrackingError('Ward freight tracking is not configured for this organization.', 'not_configured');
  if (reference.providerMode && reference.providerMode !== 'production') throw new SupplyTrackingError('Ward cannot replace a test tracking result.', 'mode_mismatch');
  const pro = wardProNumber(reference.referenceType === 'FREIGHT_PRO' ? reference.reference : reference.proNumber);
  const bol = reference.referenceType === 'BILL_OF_LADING' ? normalizedReference(reference.reference) : null;
  const origin = reference.originPostalCode ?? null;
  const destination = reference.destinationPostalCode;
  if (!destination || !/^\d{5}$/.test(destination) || (reference.referenceType === 'FREIGHT_PRO' ? !pro : !bol || !/^[A-Z0-9-]{3,40}$/.test(bol) || !pro && !/^\d{5}$/.test(origin ?? ''))) {
    throw new SupplyTrackingError('Ward tracking requires a valid PRO or a verified BOL and origin ZIP, plus a verified destination ZIP.', 'invalid_reference');
  }

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(WARD_TRACE_URL, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(Math.max(1_000, Math.min(15_000, options.timeoutMs ?? 8_000))),
      headers: { authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ body: { request: { freightBill: pro ?? '', freightBillType: pro ? 'WARDPRO' : '', bopoNumber: pro ? '' : bol, bopoNumberType: pro ? '' : 'BO', oZip: pro ? '' : origin } } }),
    });
  } catch {
    throw new SupplyTrackingError('The Ward tracking connection could not be reached.', 'network', true);
  }
  if (!response.ok) {
    const temporary = response.status === 408 || response.status === 429 || response.status >= 500;
    const retryAfter = response.headers.get('retry-after');
    throw new SupplyTrackingError(response.status === 401 || response.status === 403 ? 'Ward tracking authorization was rejected.' : `Ward tracking returned HTTP ${response.status}.`,
      `http_${response.status}`, temporary, retryAfter && /^\d+$/.test(retryAfter) ? Math.min(300, Number(retryAfter)) : undefined);
  }
  let payload: unknown;
  try {
    const body = await response.text();
    if (body.length > 1_000_000) throw new Error('Response limit');
    payload = JSON.parse(body);
  } catch {
    throw new SupplyTrackingError('Ward returned an unsupported shipment response.', 'invalid_response');
  }
  return parseWardObservation(payload, reference, { pro, bol, origin, destination }, options.observedAt ?? new Date());
}
