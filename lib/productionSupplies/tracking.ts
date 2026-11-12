import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { getWatchedSupplyOrderScope, isWatchedSupplyOrder, isWatchedSupplyOrderRecord } from './watch';

/** All requests go to this fixed official API. Email-supplied URLs are never fetched. */
type TrackingEnvironment = Record<string, string | undefined>;
const API_ROOT = 'https://api.easypost.com/v2';
const MAX_WEBHOOK_BYTES = 256_000;
const MIN_REFRESH_MS = 5 * 60_000;
const LEASE_MS = 4 * 60_000;
export const SUPPORTED_PARCEL_CARRIERS = ['UPS', 'USPS', 'FedEx', 'DHLExpress', 'OnTrac', 'CanadaPost', 'RoyalMail'] as const;

export class SupplyTrackingError extends Error {
  constructor(message: string, readonly code: string, readonly temporary = false, readonly retryAfterSeconds?: number) { super(message); }
}

export type TrackingConfiguration = {
  mode: 'disabled' | 'test' | 'live';
  providerMode: 'test' | 'production' | null;
  configured: boolean;
  liveEnabled: boolean;
  reason: string | null;
};

export function getTrackingConfiguration(env: TrackingEnvironment = process.env): TrackingConfiguration {
  const mode = env.SUPPLY_TRACKING_MODE?.trim().toLowerCase() || 'disabled';
  if (!['disabled', 'test', 'live'].includes(mode)) throw new SupplyTrackingError('SUPPLY_TRACKING_MODE must be disabled, test or live.', 'configuration');
  const liveEnabled = env.SUPPLY_TRACKING_LIVE_ENABLED?.trim().toLowerCase() === 'true';
  const key = mode === 'test' ? env.EASYPOST_TEST_API_KEY : mode === 'live' ? env.EASYPOST_LIVE_API_KEY : null;
  const reason = mode === 'disabled' ? 'Automated parcel tracking is disabled. Configure an EasyPost account and environment-specific API key.'
    : !key?.trim() ? `Set ${mode === 'test' ? 'EASYPOST_TEST_API_KEY' : 'EASYPOST_LIVE_API_KEY'} on the server.`
      : mode === 'live' && !liveEnabled ? 'Live tracking registrations can incur provider fees. Set SUPPLY_TRACKING_LIVE_ENABLED=true after approving the account charges.' : null;
  return { mode: mode as TrackingConfiguration['mode'], providerMode: mode === 'disabled' ? null : mode === 'test' ? 'test' : 'production', configured: !reason, liveEnabled, reason };
}

const nullableText = z.string().max(4_000).nullish();
const trackerSchema = z.object({
  id: z.string().regex(/^trk_[A-Za-z0-9_]+$/).max(150),
  object: z.literal('Tracker').optional(),
  mode: z.enum(['test', 'production']),
  tracking_code: z.string().min(1).max(200),
  carrier: nullableText,
  status: z.string().max(80),
  status_detail: nullableText,
  updated_at: z.string().datetime({ offset: true }),
  est_delivery_date: nullableText,
  carrier_detail: z.object({ est_delivery_date_local: nullableText, est_delivery_time_local: nullableText }).nullish(),
  tracking_details: z.array(z.object({ status: nullableText, status_detail: nullableText, message: nullableText, datetime: nullableText })).max(2_000).optional(),
});
type Tracker = z.infer<typeof trackerSchema>;
export type TrackingReference = { referenceType: string; reference: string; carrier?: string | null; providerTrackingId?: string | null; providerMode?: string | null; timezone?: string | null; returnedAt?: Date | null };
export type NormalizedTrackingObservation = {
  provider: 'EASYPOST'; providerTrackingId: string; providerMode: 'test' | 'production'; trackingCode: string; carrier: string | null;
  eventKey: string; providerEventAt: Date; observedAt: Date; status: string; summary: string; returned: boolean; deliveredAt: Date | null;
  estimate: { source: 'CARRIER'; precision: 'DATE' | 'TIME_WINDOW'; startDate: string; endDate: string | null; timeStart: string | null; timeEnd: string | null; timezone: string } | null;
};

function validDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
function safeTimezone(timezone?: string | null) {
  const value = timezone || 'America/New_York';
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return value; }
  catch { return 'America/New_York'; }
}
function estimateDate(tracker: Tracker, timezone: string) {
  const local = validDate(tracker.carrier_detail?.est_delivery_date_local);
  if (local) return local;
  const raw = tracker.est_delivery_date;
  const dateOnly = validDate(raw);
  if (dateOnly) return dateOnly;
  if (!raw || !/^\d{4}-\d{2}-\d{2}T/.test(raw)) return null;
  // A timezone-less carrier datetime is local; never interpret it through the server timezone.
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return validDate(raw.slice(0, 10));
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
}

export function parseEasyPostObservation(value: unknown, options: { timezone?: string | null; observedAt?: Date; eventKey?: string; returnedAt?: Date | null } = {}): NormalizedTrackingObservation {
  const parsed = trackerSchema.safeParse(value);
  if (!parsed.success) throw new SupplyTrackingError('EasyPost returned an unsupported tracking response.', 'invalid_response');
  const tracker = parsed.data;
  const timezone = safeTimezone(options.timezone);
  const providerEventAt = new Date(tracker.updated_at);
  const hasReturnEvidence = tracker.status === 'return_to_sender' || tracker.status_detail === 'return'
    || (tracker.tracking_details ?? []).some(detail => detail.status === 'return_to_sender' || detail.status_detail === 'return');
  const returned = hasReturnEvidence || Boolean(options.returnedAt);
  const status = tracker.status === 'return_to_sender' || tracker.status === 'delivered' && returned ? 'RETURNED'
    : tracker.status === 'cancelled' ? 'CANCELLED'
      : ['failure', 'error'].includes(tracker.status) || ['delayed', 'weather_delay', 'delivery_exception', 'transit_exception', 'damaged', 'lost', 'refused'].includes(tracker.status_detail ?? '') ? 'DELAYED'
        : ({ pre_transit: 'LABEL_CREATED', in_transit: 'IN_TRANSIT', out_for_delivery: 'OUT_FOR_DELIVERY', delivered: 'DELIVERED', available_for_pickup: 'PICKUP_REQUIRED' } as Record<string, string>)[tracker.status] ?? 'UNKNOWN';
  const startDate = estimateDate(tracker, timezone);
  const localTime = tracker.carrier_detail?.est_delivery_time_local;
  const timeStart = startDate && localTime && /^\d{2}:\d{2}(?::\d{2})?$/.test(localTime) && Number(localTime.slice(0, 2)) < 24 && Number(localTime.slice(3, 5)) < 60 ? localTime : null;
  const deliveredTimes = (tracker.tracking_details ?? []).filter(detail => detail.status === 'delivered' && z.string().datetime({ offset: true }).safeParse(detail.datetime).success).map(detail => new Date(detail.datetime!)).sort((a, b) => b.getTime() - a.getTime());
  const deliveredTime = deliveredTimes[0] ?? null;
  const normalized = { provider: 'EASYPOST' as const, providerTrackingId: tracker.id, providerMode: tracker.mode, trackingCode: tracker.tracking_code,
    carrier: tracker.carrier ?? null, providerEventAt, observedAt: options.observedAt ?? new Date(), status, returned,
    summary: returned && tracker.status === 'delivered' ? 'Carrier reports delivery after a return-to-sender event; facility receipt remains unconfirmed.'
      : `${tracker.mode === 'test' ? 'TEST DATA: ' : ''}${tracker.status.replace(/_/g, ' ')}${tracker.status_detail ? ` · ${tracker.status_detail.replace(/_/g, ' ')}` : ''}`,
    deliveredAt: status === 'DELIVERED' ? deliveredTime : null,
    estimate: startDate ? { source: 'CARRIER' as const, precision: timeStart ? 'TIME_WINDOW' as const : 'DATE' as const, startDate, endDate: null, timeStart, timeEnd: timeStart, timezone } : null };
  return { ...normalized, eventKey: options.eventKey ?? createHash('sha256').update(JSON.stringify({ ...normalized, observedAt: undefined })).digest('hex') };
}

function carrierName(value?: string | null) {
  if (!value?.trim()) return null;
  const normalized = value.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const carrier = SUPPORTED_PARCEL_CARRIERS.find(item => item.toLowerCase() === normalized);
  if (!carrier) throw new SupplyTrackingError(`Automatic tracking is not configured for carrier ${value.slice(0, 100)}. Keep the supplier schedule or manual expectation until an approved adapter is available.`, 'unsupported_carrier');
  return carrier;
}

export async function lookupEasyPostTracking(reference: TrackingReference, options: { env?: TrackingEnvironment; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; observedAt?: Date; timeoutMs?: number; maxAttempts?: number } = {}) {
  if (reference.referenceType !== 'PARCEL') throw new SupplyTrackingError(`Automatic ${reference.referenceType.toLowerCase().replace(/_/g, ' ')} lookup needs a carrier-specific or supplier-approved integration; this is not a parcel tracking number.`, 'unsupported_reference');
  if (!/^[A-Za-z0-9 -]{5,200}$/.test(reference.reference)) throw new SupplyTrackingError('The parcel tracking reference has an unsupported format.', 'invalid_reference');
  const env = options.env ?? process.env;
  const config = getTrackingConfiguration(env);
  if (!config.configured) throw new SupplyTrackingError(config.reason!, 'not_configured');
  if (reference.providerMode && reference.providerMode !== config.providerMode) throw new SupplyTrackingError('This shipment belongs to a different tracking credential mode. Switch to the matching environment; test and live registrations cannot be mixed.', 'mode_mismatch');
  const key = (config.mode === 'test' ? env.EASYPOST_TEST_API_KEY : env.EASYPOST_LIVE_API_KEY)!.trim();
  const carrier = carrierName(reference.carrier);
  if (!carrier) throw new SupplyTrackingError('Select the parcel carrier before automatic registration to avoid ambiguous detection and duplicate tracking charges.', 'carrier_required');
  const trackerId = reference.providerTrackingId;
  if (trackerId && !/^trk_[A-Za-z0-9_]{1,140}$/.test(trackerId)) throw new SupplyTrackingError('Stored provider tracker ID is invalid.', 'invalid_reference');
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const maxAttempts = Math.max(1, Math.min(3, options.maxAttempts ?? 3));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(trackerId ? `${API_ROOT}/trackers/${trackerId}` : `${API_ROOT}/trackers`, {
        method: trackerId ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(Math.max(1000, Math.min(15_000, options.timeoutMs ?? 15_000))),
        headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`, 'content-type': 'application/json' },
        ...(trackerId ? {} : { body: JSON.stringify({ tracker: { tracking_code: reference.reference.replace(/ /g, ''), carrier } }) }),
      });
    } catch {
      if (attempt < maxAttempts - 1) { await sleep(500 * 2 ** attempt); continue; }
      throw new SupplyTrackingError('The tracking connection timed out or could not be reached. The last valid estimate is retained.', 'network', true);
    }
    if (!response.ok) {
      const temporary = response.status === 408 || response.status === 429 || response.status >= 500;
      const header = response.headers.get('retry-after');
      const retryAfter = header && /^\d+$/.test(header) ? Math.min(300, Number(header)) : undefined;
      if (temporary && attempt < maxAttempts - 1 && (retryAfter ?? 0) <= 10) { await sleep((retryAfter ?? 0.5 * 2 ** attempt) * 1000); continue; }
      throw new SupplyTrackingError(response.status === 401 || response.status === 403
        ? 'EasyPost or carrier authorization is required. Verify this environment’s key, account tracking access and any required carrier credentials.'
        : `The tracking provider returned HTTP ${response.status}. The last valid estimate is retained.`, `http_${response.status}`, temporary, retryAfter);
    }
    const text = await response.text();
    if (text.length > 1_000_000) throw new SupplyTrackingError('The tracking response exceeded the allowed size.', 'invalid_response');
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new SupplyTrackingError('The tracking provider returned invalid JSON.', 'invalid_response'); }
    const observation = parseEasyPostObservation(data, { timezone: reference.timezone, returnedAt: reference.returnedAt, observedAt: options.observedAt });
    if (observation.providerMode !== config.providerMode) throw new SupplyTrackingError('The provider returned a response from the wrong credential mode.', 'mode_mismatch');
    if (observation.trackingCode.replace(/ /g, '').toUpperCase() !== reference.reference.replace(/ /g, '').toUpperCase()) throw new SupplyTrackingError('The provider returned a different shipment reference.', 'reference_mismatch');
    return observation;
  }
  throw new SupplyTrackingError('Tracking lookup did not complete.', 'network', true);
}

export function verifyEasyPostWebhook(rawBody: string, headers: Headers, path: string, env: TrackingEnvironment = process.env, now = new Date()) {
  const secret = env.EASYPOST_WEBHOOK_SECRET?.trim();
  if (!secret || Buffer.byteLength(rawBody) > MAX_WEBHOOK_BYTES) throw new SupplyTrackingError('Webhook authentication failed.', 'webhook_unauthorized');
  const timestamp = headers.get('x-timestamp');
  const signedPath = headers.get('x-path');
  const signature = headers.get('x-hmac-signature-v2');
  const time = timestamp ? new Date(timestamp).getTime() : NaN;
  if (!timestamp || !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} (?:[+-]\d{4}|GMT)$/.test(timestamp) || !Number.isFinite(time) || now.getTime() - time > 60_000 || time - now.getTime() > 30_000 || signedPath !== path || !signature || !/^hmac-sha256-hex=[a-f\d]{64}$/i.test(signature)) throw new SupplyTrackingError('Webhook authentication failed.', 'webhook_unauthorized');
  const expected = createHmac('sha256', secret).update(`${timestamp}POST${signedPath}${rawBody}`).digest('hex');
  const actual = signature.slice('hmac-sha256-hex='.length).toLowerCase();
  if (!timingSafeEqual(Buffer.from(expected, 'hex') as unknown as NodeJS.ArrayBufferView, Buffer.from(actual, 'hex') as unknown as NodeJS.ArrayBufferView)) throw new SupplyTrackingError('Webhook authentication failed.', 'webhook_unauthorized');
}

const webhookSchema = z.object({ id: z.string().regex(/^evt_[A-Za-z0-9_]+$/).max(160), object: z.literal('Event'), description: z.literal('tracker.updated'), mode: z.enum(['test', 'production']), result: trackerSchema });

export function parseEasyPostWebhook(rawBody: string) {
  let value: unknown;
  try { value = JSON.parse(rawBody); } catch { throw new SupplyTrackingError('Invalid webhook body.', 'invalid_webhook'); }
  const event = webhookSchema.safeParse(value);
  if (!event.success || event.data.mode !== event.data.result.mode) throw new SupplyTrackingError('Unsupported tracking webhook.', 'invalid_webhook');
  return event.data;
}

export function nextTrackingCheck(status: string, failureCount: number, now = new Date(), startDate?: string | null) {
  if (['CANCELLED', 'RETURNED'].includes(status)) return null;
  if (failureCount) return new Date(now.getTime() + Math.min(24 * 60, 15 * 2 ** Math.min(failureCount - 1, 7)) * 60_000);
  if (status === 'DELIVERED') return new Date(now.getTime() + 24 * 60 * 60_000);
  const dueSoon = Boolean(startDate && new Date(`${startDate}T23:59:59Z`).getTime() - now.getTime() < 48 * 60 * 60_000);
  return new Date(now.getTime() + (status === 'OUT_FOR_DELIVERY' || dueSoon ? 60 : 4 * 60) * 60_000);
}

type TrackingDb = PrismaClient;
type TrackingOptions = { manual?: boolean; env?: TrackingEnvironment; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: Date; timeoutMs?: number; maxAttempts?: number; budgetMs?: number; maxShipments?: number };
export type TrackingRefreshResult = { status: 'updated' | 'busy' | 'rate_limited' | 'failed' | 'stale' | 'duplicate' | 'out_of_scope'; message?: string };

async function assertTrackingTenant(organizationId: string, db: TrackingDb | Prisma.TransactionClient) {
  const enabled = await db.organizationFeature.findFirst({ where: { organizationId, featureKey: 'PRODUCTION_SUPPLIES', enabled: true, organization: { active: true, accountStatus: { notIn: ['SUSPENDED', 'CANCELLED'] } } }, select: { id: true } });
  if (!enabled) throw new SupplyTrackingError('Production Supplies is unavailable for this organization.', 'feature_disabled');
}

function configuredNextCheck(observation: NormalizedTrackingObservation, now: Date, env: TrackingEnvironment) {
  const base = nextTrackingCheck(observation.status, 0, now, observation.estimate?.startDate);
  if (!base || ['DELIVERED', 'RETURNED', 'CANCELLED'].includes(observation.status)) return base;
  const dueSoon = base.getTime() - now.getTime() <= 60 * 60_000;
  const raw = Number(dueSoon ? env.SUPPLY_TRACKING_DUE_MINUTES : env.SUPPLY_TRACKING_ACTIVE_MINUTES);
  const minutes = Number.isFinite(raw) && raw >= 15 && raw <= 1440 ? raw : dueSoon ? 60 : 240;
  return new Date(now.getTime() + minutes * 60_000);
}

/** A tracking observation is evidence, never an inventory transaction or internal receipt. */
export async function persistSupplyTrackingObservation(organizationId: string, shipmentId: string, observation: NormalizedTrackingObservation, db: TrackingDb = prisma,
  options: { leaseId?: string; env?: TrackingEnvironment; expectedReference?: string } = {}): Promise<TrackingRefreshResult> {
  return db.$transaction(async tx => {
    await assertTrackingTenant(organizationId, tx);
    // Serializes webhook and poll writers, including retries through transaction-pooling connections.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supply_tracking:${organizationId}:${shipmentId}`}))`;
    const shipment = await tx.supplyShipment.findFirst({ where: { organizationId, id: shipmentId }, include: { arrivalEstimates: { where: { current: true }, orderBy: { sourceEventAt: 'desc' } }, order: { select: { sources: { where: { source: { historical: true } }, take: 1, select: { sourceId: true } } } } } });
    if (!shipment) throw new SupplyTrackingError('Shipment was not found.', 'not_found');
    if (options.leaseId && shipment.leaseId !== options.leaseId) return { status: 'busy', message: 'A newer worker owns this shipment refresh.' };
    if (!await isWatchedSupplyOrder(organizationId, shipment.orderId, tx)) {
      if (options.leaseId) await tx.supplyShipment.updateMany({ where: { organizationId, id: shipmentId, leaseId: options.leaseId }, data: { leaseId: null, leaseUntil: null } });
      return { status: 'out_of_scope', message: 'Tracking is limited to orders for Dx5-alerted materials. Retained shipment evidence is unchanged.' };
    }
    if (options.expectedReference && shipment.reference !== options.expectedReference) return { status: 'stale', message: 'Tracking reference changed while this lookup was running.' };
    if (shipment.providerMode && shipment.providerMode !== observation.providerMode) throw new SupplyTrackingError('Tracking credential modes cannot be mixed.', 'mode_mismatch');
    if (shipment.reference.replace(/ /g, '').toUpperCase() !== observation.trackingCode.replace(/ /g, '').toUpperCase()) throw new SupplyTrackingError('Tracking reference does not match this shipment.', 'reference_mismatch');
    if (shipment.providerTrackingId && shipment.providerTrackingId !== observation.providerTrackingId) throw new SupplyTrackingError('Provider tracker does not match this shipment.', 'reference_mismatch');
    const existing = await tx.supplyTrackingObservation.findUnique({ where: { organizationId_shipmentId_eventKey: { organizationId, shipmentId, eventKey: observation.eventKey } }, select: { id: true } });
    const isStale = Boolean(shipment.statusEventAt && shipment.statusEventAt.getTime() > observation.providerEventAt.getTime());
    if (!existing) await tx.supplyTrackingObservation.create({ data: { organizationId, shipmentId, provider: observation.provider, eventKey: observation.eventKey,
      providerEventAt: observation.providerEventAt, observedAt: observation.observedAt, status: observation.status, summary: observation.summary,
      raw: { providerTrackingId: observation.providerTrackingId, mode: observation.providerMode, estimate: observation.estimate } as Prisma.InputJsonValue } });
    const nextCheckAt = configuredNextCheck(observation, observation.observedAt, options.env ?? process.env);
    if (existing || isStale) {
      await tx.supplyShipment.updateMany({ where: { organizationId, id: shipmentId, ...(options.leaseId ? { leaseId: options.leaseId } : {}) }, data: {
        lastSuccessfulCheckAt: observation.observedAt, checkError: null, failureCount: 0,
        ...(options.leaseId ? { leaseId: null, leaseUntil: null, nextCheckAt } : {}),
      } });
      return { status: isStale ? 'stale' : 'duplicate', message: isStale ? 'Older provider evidence retained in history; the newer shipment result is unchanged.' : 'Tracking is current; no new provider update.' };
    }
    // A delivery after a return event may be delivery back to the sender.
    const returned = observation.returned || Boolean(shipment.returnedAt);
    const status = observation.status === 'DELIVERED' && returned ? 'RETURNED' : observation.status;
    const estimate = observation.estimate;
    const priorCarrier = shipment.arrivalEstimates.find(item => item.source === 'CARRIER');
    const originalPromise = shipment.arrivalEstimates.filter(item => item.source === 'SUPPLIER_PROMISE').at(-1);
    const previousArrival = priorCarrier?.startDate ?? originalPromise?.startDate;
    const estimateChanged = estimate && (!priorCarrier || ['startDate', 'endDate', 'timeStart', 'timeEnd', 'precision', 'timezone'].some(key => priorCarrier[key as keyof typeof priorCarrier] !== estimate[key as keyof typeof estimate]));
    if (estimateChanged) {
      await tx.supplyArrivalEstimate.updateMany({ where: { organizationId, shipmentId, source: 'CARRIER', current: true }, data: { current: false } });
      await tx.supplyArrivalEstimate.create({ data: { organizationId, shipmentId, ...estimate, sourceEventAt: observation.providerEventAt, observedAt: observation.observedAt, sourceId: observation.eventKey } });
    }
    if (!estimate && priorCarrier) {
      // A successful provider correction that withdraws its ETA differs from an outage.
      await tx.supplyArrivalEstimate.updateMany({ where: { organizationId, shipmentId, source: 'CARRIER', current: true }, data: { current: false } });
    }
    const slipped = Boolean(estimate && previousArrival && estimate.startDate > previousArrival);
    const exception = ['DELAYED', 'PICKUP_REQUIRED', 'RETURNED', 'CANCELLED'].includes(status);
    const newlyDelivered = status === 'DELIVERED' && shipment.status !== 'DELIVERED';
    const condition = slipped ? `eta:${estimate!.startDate}` : exception ? `exception:${status}` : newlyDelivered ? 'awaiting-receipt' : null;
    const historicalInitialLookup = !shipment.providerTrackingId && Boolean(shipment.order?.sources.length);
    if (condition && observation.providerMode === 'production' && !historicalInitialLookup) {
      const fingerprint = createHash('sha256').update(`${shipmentId}:${condition}`).digest('hex');
      await tx.supplyNotification.upsert({ where: { organizationId_fingerprint: { organizationId, fingerprint } }, update: {}, create: {
        organizationId, shipmentId, fingerprint,
        title: slipped ? 'Production supply arrival estimate changed' : newlyDelivered ? 'Production supplies awaiting receipt' : 'Production supply shipment needs attention',
        body: slipped ? `Carrier estimate moved from ${previousArrival} to ${estimate!.startDate}. The original promise remains in shipment history.`
          : newlyDelivered ? 'The carrier reports delivery. Confirm actual received quantities, shortages or damage; linked needs remain open.' : observation.summary,
      } });
    }
    await tx.supplyShipment.updateMany({ where: { organizationId, id: shipmentId, ...(options.leaseId ? { leaseId: options.leaseId } : {}) }, data: {
      provider: observation.provider, providerTrackingId: observation.providerTrackingId, providerMode: observation.providerMode, status,
      statusEventAt: observation.providerEventAt, deliveredAt: status === 'DELIVERED' ? observation.deliveredAt ?? shipment.deliveredAt : shipment.deliveredAt,
      returnedAt: returned ? shipment.returnedAt ?? observation.providerEventAt : null,
      lastSuccessfulCheckAt: observation.observedAt, lastCheckedAt: observation.observedAt, nextCheckAt,
      checkError: null, failureCount: 0, ...(options.leaseId ? { leaseId: null, leaseUntil: null } : {}),
    } });
    return { status: 'updated', message: observation.providerMode === 'test' ? 'Updated from EasyPost test data; this is not a live carrier result.' : estimate ? 'Updated from the carrier tracking provider.' : 'Carrier has not provided an arrival estimate; automatic checks continue.' };
  }, { timeout: 30_000 });
}

/** Called from authenticated UI actions and the scheduled worker. The action owns user permissions. */
export async function refreshSupplyShipmentTracking(organizationId: string, shipmentId: string, db: TrackingDb = prisma, options: TrackingOptions = {}): Promise<TrackingRefreshResult> {
  await assertTrackingTenant(organizationId, db);
  const now = options.now ?? new Date();
  const shipment = await db.supplyShipment.findFirst({ where: { organizationId, id: shipmentId } });
  if (!shipment) throw new SupplyTrackingError('Shipment was not found.', 'not_found');
  if (!await isWatchedSupplyOrder(organizationId, shipment.orderId, db)) return { status: 'out_of_scope', message: 'Tracking is limited to orders for Dx5-alerted materials.' };
  if (options.manual && shipment.lastCheckedAt && now.getTime() - shipment.lastCheckedAt.getTime() < MIN_REFRESH_MS) return { status: 'rate_limited', message: 'Tracking was checked recently. Please wait five minutes between manual refreshes.' };
  const leaseId = randomUUID();
  const claimed = await db.supplyShipment.updateMany({ where: { organizationId, id: shipmentId, AND: [
    { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
    options.manual ? { OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: new Date(now.getTime() - MIN_REFRESH_MS) } }] } : { nextCheckAt: { lte: now } },
  ] }, data: { leaseId, leaseUntil: new Date(now.getTime() + LEASE_MS), lastCheckedAt: now } });
  if (!claimed.count) return { status: 'busy', message: 'Tracking is already refreshing or another worker has completed this check.' };
  try {
    const observation = await lookupEasyPostTracking(shipment, { ...options, observedAt: now });
    return await persistSupplyTrackingObservation(organizationId, shipmentId, observation, db, { leaseId, env: options.env, expectedReference: shipment.reference });
  } catch (error) {
    const message = error instanceof SupplyTrackingError ? error.message : 'Tracking could not be saved. The last valid shipment result is retained.';
    const failureCount = shipment.failureCount + 1;
    const temporary = error instanceof SupplyTrackingError && error.temporary;
    const nextCheckAt = error instanceof SupplyTrackingError && ['not_configured', 'unsupported_reference', 'unsupported_carrier', 'carrier_required', 'mode_mismatch', 'invalid_reference'].includes(error.code)
      ? new Date(now.getTime() + 24 * 60 * 60_000) : nextTrackingCheck(shipment.status, failureCount, now);
    const retryAt = temporary && error.retryAfterSeconds ? new Date(now.getTime() + error.retryAfterSeconds * 1000) : null;
    await db.supplyShipment.updateMany({ where: { organizationId, id: shipmentId, leaseId }, data: { checkError: message, failureCount,
      nextCheckAt: retryAt && (!nextCheckAt || retryAt > nextCheckAt) ? retryAt : nextCheckAt, leaseId: null, leaseUntil: null } });
    return { status: 'failed', message };
  }
}

/** Bounded background reconciliation continues without an open dashboard. */
export async function runDueSupplyTracking(organizationId: string, db: TrackingDb = prisma, options: TrackingOptions = {}) {
  await assertTrackingTenant(organizationId, db);
  const now = options.now ?? new Date();
  const scope = await getWatchedSupplyOrderScope(organizationId, db);
  if (!scope.materials.length) return { attempted: 0, succeeded: 0, failed: 0 };
  const candidates = await db.supplyShipment.findMany({ where: { organizationId, order: scope.orderWhere, nextCheckAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, orderBy: [{ nextCheckAt: 'asc' }, { id: 'asc' }], take: 40, include: { order: { include: { lines: { where: { ignored: false }, include: { allocations: { select: { needId: true } } } } } } } });
  const due = candidates.filter(shipment => isWatchedSupplyOrderRecord(shipment.order, scope.materials)).slice(0, Math.max(1, Math.min(10, options.maxShipments ?? 10)));
  const results: TrackingRefreshResult[] = [];
  const deadline = Date.now() + Math.max(1000, Math.min(180_000, options.budgetMs ?? 180_000));
  for (const shipment of due) {
    if (Date.now() > deadline) break;
    results.push(await refreshSupplyShipmentTracking(organizationId, shipment.id, db, options));
  }
  return { attempted: results.length, succeeded: results.filter(result => ['updated', 'duplicate', 'stale'].includes(result.status)).length, failed: results.filter(result => result.status === 'failed').length };
}

export async function handleSupplyTrackingWebhook(rawBody: string, headers: Headers, path: string, db: TrackingDb = prisma, env: TrackingEnvironment = process.env, now = new Date()) {
  verifyEasyPostWebhook(rawBody, headers, path, env, now);
  const event = parseEasyPostWebhook(rawBody);
  const config = getTrackingConfiguration(env);
  if (!config.configured || config.providerMode !== event.mode) throw new SupplyTrackingError('Webhook mode is not enabled for this environment.', 'mode_mismatch');
  const mappings = await db.supplyShipment.findMany({ where: { provider: 'EASYPOST', providerTrackingId: event.result.id, providerMode: event.mode }, select: { id: true, organizationId: true, timezone: true, returnedAt: true } });
  // Only pre-existing stored mappings select tenants. Payloads never supply tenant IDs.
  for (const shipment of mappings) {
    try {
      const observation = parseEasyPostObservation(event.result, { observedAt: now, eventKey: event.id, timezone: shipment.timezone, returnedAt: shipment.returnedAt });
      await persistSupplyTrackingObservation(shipment.organizationId, shipment.id, observation, db, { env });
    } catch (error) {
      if (!(error instanceof SupplyTrackingError && error.code === 'feature_disabled')) throw error;
    }
  }
  return { accepted: true };
}
