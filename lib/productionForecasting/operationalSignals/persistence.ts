// Server-only: all dashboard reads use persisted facts, never provider requests.
import { z } from 'zod';
import type { DeliveryAvailabilityObservation, PrismaClient } from '@prisma/client';
import { prisma } from '../../prisma';
import { openDockConfiguration, requireOperationalSignalOrganization } from './credentials';
import { businessLeadDays, calendarLeadDays, dateInTimezone, deliveryBaseline } from './delivery';
import type { DeliveryAvailabilityResult, OpenDockLocationConfig } from './types';

const resultSchema = z.object({
  market: z.literal('OH'), locationCode: z.enum(['GPT', 'GRN']), locationName: z.string().trim().min(1).max(160),
  warehouseId: z.string().uuid(), loadTypeId: z.string().uuid(), timezone: z.string().min(1).max(100),
  observedAt: z.string().datetime({ offset: true }), source: z.literal('OPENDOCK'),
  status: z.enum(['SUCCESS', 'NO_AVAILABILITY', 'AUTH_FAILED', 'UNAVAILABLE', 'INVALID_RESPONSE', 'NOT_CONFIGURED']),
  earliestAvailableAt: z.string().datetime({ offset: true }).nullable(),
  calendarDays: z.number().int().min(0).max(3660).nullable(), businessDays: z.number().int().min(0).max(3660).nullable(),
  businessDayMethod: z.literal('SOURCE_OPERATING_CALENDAR').nullable(),
  checkedThrough: z.string().datetime({ offset: true }).nullable(),
  diagnosticCode: z.string().regex(/^[A-Z0-9_:-]{1,100}$/).nullable(),
}).strict();
const successful = (status: string) => status === 'SUCCESS' || status === 'NO_AVAILABILITY';
const dailyKey = (organizationId: string, location: Pick<OpenDockLocationConfig, 'market' | 'locationCode'>, observedOn: string) => ({ organizationId, market: location.market, locationCode: location.locationCode, source: 'OPENDOCK', observedOn: new Date(observedOn) });

function checkedResult(input: DeliveryAvailabilityResult, locations: readonly OpenDockLocationConfig[]) {
  const result = resultSchema.parse(input);
  const location = locations.find(value => value.locationCode === result.locationCode && value.market === result.market);
  if (!location || location.warehouseId !== result.warehouseId || location.loadTypeId !== result.loadTypeId || location.timezone !== result.timezone) throw new Error('Delivery source does not match the verified organization warehouse mapping.');
  const at = new Date(result.observedAt), through = result.checkedThrough ? new Date(result.checkedThrough) : null;
  if (through && through < at) throw new Error('Delivery search range precedes its observation.');
  if (successful(result.status) && !through) throw new Error('Successful delivery checks require a bounded search range.');
  if (result.status === 'SUCCESS') {
    if (!result.earliestAvailableAt || result.calendarDays === null || new Date(result.earliestAvailableAt) < at || new Date(result.earliestAvailableAt) > through!) throw new Error('A successful delivery result requires an appointment within its checked range.');
    if (calendarLeadDays(at, result.earliestAvailableAt, location.timezone) !== result.calendarDays) throw new Error('Delivery calendar lead time does not match the source dates.');
    const business = businessLeadDays(at, result.earliestAvailableAt, location.timezone, location.calendar);
    if (business !== result.businessDays || (business === null) !== (result.businessDayMethod === null)) throw new Error('Delivery business lead time requires a complete matching source calendar.');
  } else if (result.earliestAvailableAt !== null || result.calendarDays !== null || result.businessDays !== null || result.businessDayMethod !== null) throw new Error('Unavailable delivery data cannot be stored as a numeric lead time.');
  return { result, location, observedOn: dateInTimezone(at, location.timezone) };
}

/** One successful daily fact per location; retries/failures only update attempt state. */
export async function recordDeliveryAvailability(organizationId: string, input: DeliveryAvailabilityResult, db: PrismaClient = prisma) {
  return db.$transaction(async tx => {
    const organization = await requireOperationalSignalOrganization(organizationId, tx);
    const configured = openDockConfiguration(organization.settings);
    const { result, observedOn } = checkedResult(input, configured.locations);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`production-operational-signals:${organizationId}`}))`;
    const key = dailyKey(organizationId, result, observedOn);
    const [prior, priorCheck] = await Promise.all([
      tx.deliveryAvailabilityObservation.findUnique({ where: { organizationId_market_locationCode_source_observedOn: key } }),
      tx.deliveryAvailabilityCheck.findUnique({ where: { organizationId_market_locationCode_source_observedOn: key } }),
    ]);
    const matchesMapping = (row: { warehouseId: string; loadTypeId: string; timezone: string }) => row.warehouseId === result.warehouseId && row.loadTypeId === result.loadTypeId && row.timezone === result.timezone;
    if (prior && !matchesMapping(prior) && successful(result.status)) throw new Error('Delivery mapping changed after the immutable daily snapshot. Retry on the next observation date.');
    if (priorCheck && matchesMapping(priorCheck) && priorCheck.attemptedAt >= new Date(result.observedAt)) return { id: prior?.id ?? null, replay: true, status: priorCheck.status };
    let observation = prior && matchesMapping(prior) ? prior : null;
    if (!observation && successful(result.status)) {
      observation = await tx.deliveryAvailabilityObservation.create({ data: {
        ...key, locationName: result.locationName, warehouseId: result.warehouseId, loadTypeId: result.loadTypeId, timezone: result.timezone,
        observedAt: new Date(result.observedAt), status: result.status,
        earliestAvailableAt: result.earliestAvailableAt ? new Date(result.earliestAvailableAt) : null,
        earliestAvailableDate: result.earliestAvailableAt ? new Date(dateInTimezone(result.earliestAvailableAt, result.timezone)) : null,
        rawEarliestAvailableAt: result.earliestAvailableAt, calendarDays: result.calendarDays, businessDays: result.businessDays,
        businessDayMethod: result.businessDayMethod, checkedThrough: new Date(result.checkedThrough!),
      } });
    }
    const attempt = { locationName: result.locationName, warehouseId: result.warehouseId, loadTypeId: result.loadTypeId, timezone: result.timezone, attemptedAt: new Date(result.observedAt), status: result.status, diagnosticCode: result.diagnosticCode, checkedThrough: result.checkedThrough ? new Date(result.checkedThrough) : null, observationId: observation?.id ?? null };
    await tx.deliveryAvailabilityCheck.upsert({ where: { organizationId_market_locationCode_source_observedOn: key }, create: { ...key, ...attempt }, update: { ...attempt, attemptCount: { increment: 1 } } });
    return { id: observation?.id ?? null, replay: !!prior, status: result.status };
  }, { timeout: 30000 });
}

export async function deliveryAlreadyObservedToday(organizationId: string, location: OpenDockLocationConfig, now = new Date(), db: PrismaClient = prisma) {
  const organization = await requireOperationalSignalOrganization(organizationId, db);
  const configured = openDockConfiguration(organization.settings).locations.find(value => value.locationCode === location.locationCode && value.market === location.market && value.warehouseId === location.warehouseId && value.loadTypeId === location.loadTypeId && value.timezone === location.timezone);
  if (!configured) return false;
  const key = dailyKey(organizationId, location, dateInTimezone(now, location.timezone));
  const observation = await db.deliveryAvailabilityObservation.findUnique({ where: { organizationId_market_locationCode_source_observedOn: key }, select: { warehouseId: true, loadTypeId: true, timezone: true } });
  return !!observation && observation.warehouseId === location.warehouseId && observation.loadTypeId === location.loadTypeId && observation.timezone === location.timezone;
}

export function serializeDeliveryObservation(row: DeliveryAvailabilityObservation) {
  return { ...row, observedOn: row.observedOn.toISOString().slice(0, 10), observedAt: row.observedAt.toISOString(), earliestAvailableAt: row.earliestAvailableAt?.toISOString() ?? null, earliestAvailableDate: row.earliestAvailableDate?.toISOString().slice(0, 10) ?? null, checkedThrough: row.checkedThrough.toISOString() };
}

/** Batch queries serve both warehouses and bounded history without N+1 reads. */
export async function getDeliveryAvailabilitySignals(organizationId: string, db: PrismaClient = prisma, now = new Date()) {
  const organization = await requireOperationalSignalOrganization(organizationId, db);
  const configuration = openDockConfiguration(organization.settings);
  const [observations, checks] = await Promise.all([
    db.deliveryAvailabilityObservation.findMany({ where: { organizationId, market: 'OH', source: 'OPENDOCK', locationCode: { in: ['GPT', 'GRN'] } }, orderBy: { observedAt: 'desc' }, take: 2200 }),
    db.deliveryAvailabilityCheck.findMany({ where: { organizationId, market: 'OH', source: 'OPENDOCK', locationCode: { in: ['GPT', 'GRN'] } }, distinct: ['locationCode', 'warehouseId', 'loadTypeId', 'timezone'], orderBy: { attemptedAt: 'desc' } }),
  ]);
  const warehouses = (['GPT', 'GRN'] as const).map(locationCode => {
    const mapping = configuration.locations.find(value => value.locationCode === locationCode);
    const history = observations.filter(row => row.locationCode === locationCode && (!mapping || row.warehouseId === mapping.warehouseId && row.loadTypeId === mapping.loadTypeId && row.timezone === mapping.timezone));
    const latest = history.at(0) ?? null, lastAvailable = history.find(row => row.status === 'SUCCESS') ?? null;
    const check = checks.find(row => row.locationCode === locationCode && (!mapping || row.warehouseId === mapping.warehouseId && row.loadTypeId === mapping.loadTypeId && row.timezone === mapping.timezone)) ?? null;
    const timezone = mapping?.timezone ?? latest?.timezone ?? organization.timezone;
    const ageDays = latest ? Math.max(0, Math.round((Date.parse(dateInTimezone(now, timezone)) - Date.parse(latest.observedOn.toISOString().slice(0, 10))) / 86400000)) : null;
    const freshness = ageDays === null ? 'unavailable' : ageDays === 0 ? 'current' : ageDays === 1 ? 'delayed' : 'stale';
    const currentDays = freshness === 'current' && latest?.status === 'SUCCESS' ? latest.calendarDays : null;
    return {
      market: 'OH', locationCode, locationName: mapping?.locationName ?? latest?.locationName ?? (locationCode === 'GPT' ? 'Groveport' : 'Green'),
      timezone, configured: !!mapping, latestObservation: latest ? serializeDeliveryObservation(latest) : null,
      lastAvailableObservation: lastAvailable ? serializeDeliveryObservation(lastAvailable) : null,
      latestCheck: check ? { status: check.status, attemptedAt: check.attemptedAt.toISOString(), diagnosticCode: check.diagnosticCode, checkedThrough: check.checkedThrough?.toISOString() ?? null, attemptCount: check.attemptCount } : null,
      lastSuccessfulCheckAt: latest?.observedAt.toISOString() ?? null, freshness, ageDays,
      baseline: deliveryBaseline(history.map(row => ({ observedAt: row.observedAt, calendarDays: row.calendarDays, status: row.status as DeliveryAvailabilityResult['status'] })), now, currentDays, timezone),
      history: history.slice(0, 90).map(serializeDeliveryObservation),
    };
  });
  return { configuration, warehouses };
}

export async function getDeliveryAvailabilityHistory(organizationId: string, locationCode: string, db: PrismaClient = prisma, limit = 365) {
  z.enum(['GPT', 'GRN']).parse(locationCode);
  z.number().int().min(1).max(1096).parse(limit);
  await requireOperationalSignalOrganization(organizationId, db);
  const rows = await db.deliveryAvailabilityObservation.findMany({ where: { organizationId, market: 'OH', source: 'OPENDOCK', locationCode }, orderBy: { observedAt: 'desc' }, take: limit });
  return rows.map(serializeDeliveryObservation);
}
