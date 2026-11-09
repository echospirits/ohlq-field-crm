// Server-side adapter. Call only from ingestion; dashboard modules import types/delivery instead.
import { z } from 'zod';
import { businessLeadDays, calendarLeadDays, dateInTimezone, validCalendarDate } from './delivery';
import type { DeliveryAvailabilityResult, DeliveryRetrievalStatus, OpenDockLocationConfig } from './types';

const API_ORIGIN = 'https://neutron.opendock.com';
const DAY_MS = 86_400_000;
const SEARCH_DAYS = 90;
const WINDOW_DAYS = 7;
const MAX_BODY_CHARACTERS = 2_000_000;
const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true }).refine(value => {
  // Date.parse normalizes impossible calendar dates, so validate that portion too.
  return validCalendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
});
const loginSchema = z.object({ access_token: z.string().min(20).max(20_000).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/) });
const availabilitySchema = z.object({
  data: z.array(z.object({
    startTimes: z.array(timestampSchema).max(20_000),
    availability: z.array(z.object({ start: timestampSchema, end: timestampSchema })).max(20_000).optional(),
  })).max(1_000),
});

const loadTypesSchema = z.object({
  data: z.array(z.object({
    id: uuidSchema,
    name: z.string().trim().min(1).max(200),
    warehouseId: uuidSchema.nullable().optional(),
    direction: z.enum(['Inbound', 'Outbound']),
    allowCarrierScheduling: z.literal(true),
  })).max(1_000),
  count: z.number().int().min(0).max(1_000),
  total: z.number().int().min(0).max(25_000),
  page: z.number().int().min(1).max(25),
  pageCount: z.number().int().min(0).max(25),
});

export type OpenDockCredentials = { email: string; password: string };
export type OpenDockLoadType = { warehouseId: string; id: string; name: string };
export type OpenDockLoadTypeDiscovery = {
  status: DeliveryRetrievalStatus;
  loadTypes: OpenDockLoadType[];
  diagnosticCode: string | null;
};
type ClientOptions = {
  request?: typeof fetch;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  totalTimeoutMs?: number;
};

class SourceFailure extends Error {
  constructor(readonly status: DeliveryRetrievalStatus, readonly diagnosticCode: string) {
    super('OpenDock retrieval did not complete.');
  }
}

function configured(location: OpenDockLocationConfig): boolean {
  if (!uuidSchema.safeParse(location.warehouseId).success || !uuidSchema.safeParse(location.loadTypeId).success
    || !/^[A-Z]{2}$/.test(location.market) || !location.locationCode.trim() || location.locationCode.length > 64
    || !location.locationName.trim() || location.locationName.length > 200) return false;
  try { dateInTimezone(new Date(), location.timezone); return true; } catch { return false; }
}

function retryDelay(attempt: number, retryAfter: string | null, now: number): number {
  const backoff = 1_000 * 2 ** attempt;
  if (!retryAfter) return backoff;
  const value = retryAfter.trim();
  // Retry-After permits either non-negative seconds or an HTTP date.
  // An oversized delay is retained so the deadline check refuses an early retry.
  if (/^\d+$/.test(value)) return Math.max(backoff, Number(value) * 1_000);
  const dateDelay = Date.parse(value) - now;
  return Number.isFinite(dateDelay) ? Math.max(backoff, dateDelay) : backoff;
}

/**
 * Official carrier API only: no appointment creation, no browser cookies, no redirects.
 * JWTs stay in the scope of a single availability call and never enter returned data.
 */
export class OpenDockReadClient {
  #credentials: OpenDockCredentials;
  #request: typeof fetch;
  #now: () => Date;
  #sleep: (milliseconds: number) => Promise<void>;
  #timeoutMs: number;
  #totalTimeoutMs: number;

  constructor(credentials: OpenDockCredentials, options: ClientOptions = {}) {
    if (typeof window !== 'undefined') throw new Error('OpenDock access is server-side only.');
    this.#credentials = { ...credentials };
    this.#request = options.request ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    this.#timeoutMs = Math.min(15_000, Math.max(1, options.timeoutMs ?? 15_000));
    this.#totalTimeoutMs = Math.min(90_000, Math.max(1, options.totalTimeoutMs ?? 90_000));
  }

  async #retry(attempt: number, deadline: number, diagnosticCode: string, retryAfter: string | null = null) {
    const now = Date.now(), delay = retryDelay(attempt, retryAfter, now);
    if (attempt >= 2 || delay >= deadline - now) throw new SourceFailure('UNAVAILABLE', diagnosticCode);
    await this.#sleep(delay);
  }

  async #json(path: string, body: object | null, token: string | null, deadline: number): Promise<unknown> {
    const url = new URL(path, API_ORIGIN), query = url.searchParams;
    const method = body === null ? 'GET' : 'POST';
    const login = method === 'POST' && url.pathname === '/auth/login' && !url.search;
    const availability = method === 'POST' && /^\/loadtype\/[0-9a-f-]{36}\/get-availability$/i.test(url.pathname) && !url.search;
    const discoveryKeys = ['warehouseId', 'showOnlyAssignedLoadTypes', 's', 'page'];
    const discovery = method === 'GET' && url.pathname === '/loadtype'
      && [...query.keys()].length === discoveryKeys.length && discoveryKeys.every(key => query.getAll(key).length === 1)
      && uuidSchema.safeParse(query.get('warehouseId')).success && query.get('showOnlyAssignedLoadTypes') === 'true'
      && query.get('s') === '{"allowCarrierScheduling":true}' && /^(?:[1-9]|1[0-9]|2[0-5])$/.test(query.get('page') ?? '');
    if (url.origin !== API_ORIGIN || url.username || url.password || url.hash || !(login || availability || discovery)) {
      throw new SourceFailure('NOT_CONFIGURED', 'OPENDOCK_INVALID_ENDPOINT');
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new SourceFailure('UNAVAILABLE', 'OPENDOCK_TIMEOUT');
      let response: Response;
      try {
        response = await this.#request(url, {
          method,
          ...(body === null ? {} : { body: JSON.stringify(body) }),
          headers: { 'content-type': 'application/json', accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          signal: AbortSignal.timeout(Math.min(remaining, this.#timeoutMs)),
        });
      } catch {
        await this.#retry(attempt, deadline, 'OPENDOCK_NETWORK_OR_TIMEOUT');
        continue;
      }
      if (response.redirected || response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        throw new SourceFailure('INVALID_RESPONSE', 'OPENDOCK_REDIRECT_REFUSED');
      }
      if (response.url && new URL(response.url).origin !== API_ORIGIN) throw new SourceFailure('INVALID_RESPONSE', 'OPENDOCK_ORIGIN_REFUSED');
      if (response.status === 401 || response.status === 403 || (!token && response.status === 400)) {
        throw new SourceFailure('AUTH_FAILED', 'OPENDOCK_AUTHENTICATION_REQUIRED');
      }
      if (response.status === 429 || [500, 502, 503, 504].includes(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        await this.#retry(attempt, deadline, response.status === 429 ? 'OPENDOCK_RATE_LIMITED' : 'OPENDOCK_UPSTREAM_UNAVAILABLE', response.headers.get('retry-after'));
        continue;
      }
      if (!response.ok) throw new SourceFailure('INVALID_RESPONSE', 'OPENDOCK_REQUEST_REJECTED');
      if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')
        || Number(response.headers.get('content-length') ?? 0) > MAX_BODY_CHARACTERS) {
        throw new SourceFailure('INVALID_RESPONSE', 'OPENDOCK_RESPONSE_FORMAT_CHANGED');
      }
      let text: string;
      try { text = await response.text(); }
      catch {
        // A connection can fail after headers arrive. Only completed bodies are
        // eligible for response-format validation; transport failures may retry.
        await this.#retry(attempt, deadline, 'OPENDOCK_NETWORK_OR_TIMEOUT');
        continue;
      }
      try {
        if (text.length > MAX_BODY_CHARACTERS) throw new Error('Oversized response.');
        return JSON.parse(text) as unknown;
      } catch {
        throw new SourceFailure('INVALID_RESPONSE', 'OPENDOCK_RESPONSE_FORMAT_CHANGED');
      }
    }
    throw new SourceFailure('UNAVAILABLE', 'OPENDOCK_UPSTREAM_UNAVAILABLE');
  }

  /** Setup-only discovery, not a dashboard request. Does not select a load type by guess. */
  async discoverLoadTypes(warehouseIds: readonly string[]): Promise<OpenDockLoadTypeDiscovery> {
    const ids = [...new Set(warehouseIds)];
    if (!ids.length || ids.length > 10 || ids.some(id => !uuidSchema.safeParse(id).success)
      || !z.string().email().max(320).safeParse(this.#credentials.email).success
      || !this.#credentials.password || this.#credentials.password.length > 4096) {
      return { status: 'NOT_CONFIGURED', loadTypes: [], diagnosticCode: 'OPENDOCK_CONFIGURATION_REQUIRED' };
    }
    const deadline = Date.now() + this.#totalTimeoutMs;
    try {
      const login = async () => {
        const parsed = loginSchema.safeParse(await this.#json('/auth/login', this.#credentials, null, deadline));
        if (!parsed.success) throw new SourceFailure('INVALID_RESPONSE', 'OPENDOCK_AUTH_RESPONSE_CHANGED');
        return parsed.data.access_token;
      };
      let token = await login(), renewed = false;
      const loadTypes: OpenDockLoadType[] = [];
      for (const warehouseId of ids) {
        const seen = new Map<string, string>();
        let expectedPages: number | null = null, expectedTotal: number | null = null;
        for (let page = 1; page <= 25; page++) {
          const query = new URLSearchParams({ warehouseId, showOnlyAssignedLoadTypes: 'true', s: '{"allowCarrierScheduling":true}', page: String(page) });
          const path = '/loadtype?' + query.toString();
          let response: unknown;
          try { response = await this.#json(path, null, token, deadline); }
          catch (error) {
            if (!(error instanceof SourceFailure) || error.status !== 'AUTH_FAILED' || renewed) throw error;
            token = await login(); renewed = true;
            response = await this.#json(path, null, token, deadline);
          }
          const parsed = loadTypesSchema.safeParse(response);
          if (!parsed.success || parsed.data.page !== page || parsed.data.count !== parsed.data.data.length
            || (parsed.data.pageCount === 0 ? parsed.data.total !== 0 || parsed.data.data.length !== 0 || page !== 1 : parsed.data.pageCount < page)) {
            throw new SourceFailure('INVALID_RESPONSE', 'OPENDOCK_LOAD_TYPES_RESPONSE_CHANGED');
          }
          const result = parsed.data;
          if ((expectedPages !== null && expectedPages !== result.pageCount) || (expectedTotal !== null && expectedTotal !== result.total)
            || result.data.some(value => value.warehouseId && value.warehouseId !== warehouseId)) {
            throw new SourceFailure('INVALID_RESPONSE', 'OPENDOCK_LOAD_TYPES_RESPONSE_CHANGED');
          }
          expectedPages = result.pageCount; expectedTotal = result.total;
          for (const value of result.data) {
            if (seen.has(value.id)) throw new SourceFailure('INVALID_RESPONSE', 'OPENDOCK_LOAD_TYPES_PAGINATION_CHANGED');
            seen.set(value.id, value.name);
            if (value.direction === 'Inbound') loadTypes.push({ warehouseId, id: value.id, name: value.name });
          }
          if (page >= result.pageCount) {
            if (seen.size !== result.total) throw new SourceFailure('INVALID_RESPONSE', 'OPENDOCK_LOAD_TYPES_PAGINATION_CHANGED');
            break;
          }
        }
      }
      return { status: 'SUCCESS', loadTypes, diagnosticCode: null };
    } catch (error) {
      // An incomplete discovery must never mark a partially mapped setup verified.
      return { status: error instanceof SourceFailure ? error.status : 'INVALID_RESPONSE', loadTypes: [],
        diagnosticCode: error instanceof SourceFailure ? error.diagnosticCode : 'OPENDOCK_RESPONSE_FORMAT_CHANGED' };
    }
  }

  async availability(location: OpenDockLocationConfig, observedAt: string | Date = this.#now()): Promise<DeliveryAvailabilityResult> {
    const at = new Date(observedAt);
    const base: DeliveryAvailabilityResult = {
      market: location.market, locationCode: location.locationCode, locationName: location.locationName,
      warehouseId: location.warehouseId, loadTypeId: location.loadTypeId, timezone: location.timezone,
      observedAt: Number.isFinite(at.getTime()) ? at.toISOString() : this.#now().toISOString(),
      source: 'OPENDOCK', status: 'NOT_CONFIGURED', earliestAvailableAt: null,
      calendarDays: null, businessDays: null, businessDayMethod: null,
      checkedThrough: null, diagnosticCode: null,
    };
    if (!configured(location) || !Number.isFinite(at.getTime())
      || !z.string().email().max(320).safeParse(this.#credentials.email).success
      || !this.#credentials.password || this.#credentials.password.length > 4096) {
      return { ...base, diagnosticCode: 'OPENDOCK_CONFIGURATION_REQUIRED' };
    }
    const deadline = Date.now() + this.#totalTimeoutMs;
    try {
      const login = async () => {
        const response = loginSchema.safeParse(await this.#json('/auth/login', this.#credentials, null, deadline));
        if (!response.success) throw new SourceFailure('INVALID_RESPONSE', 'OPENDOCK_AUTH_RESPONSE_CHANGED');
        return response.data.access_token;
      };
      let token = await login(), renewed = false;
      const searchEnd = at.getTime() + SEARCH_DAYS * DAY_MS;
      for (let start = at.getTime(); start < searchEnd; start += WINDOW_DAYS * DAY_MS) {
        const end = Math.min(searchEnd, start + WINDOW_DAYS * DAY_MS);
        const body = { warehouseId: location.warehouseId, includeStartTimes: true, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
        let response: unknown;
        try {
          response = await this.#json(`/loadtype/${location.loadTypeId}/get-availability`, body, token, deadline);
        } catch (error) {
          if (!(error instanceof SourceFailure) || error.status !== 'AUTH_FAILED' || renewed) throw error;
          token = await login(); renewed = true;
          response = await this.#json(`/loadtype/${location.loadTypeId}/get-availability`, body, token, deadline);
        }
        const parsed = availabilitySchema.safeParse(response);
        if (!parsed.success) throw new SourceFailure('INVALID_RESPONSE', 'OPENDOCK_AVAILABILITY_RESPONSE_CHANGED');
        const starts = parsed.data.data.flatMap(value => value.startTimes)
          .filter(value => Date.parse(value) >= start && Date.parse(value) >= at.getTime() && Date.parse(value) <= end)
          .sort((left, right) => Date.parse(left) - Date.parse(right));
        base.checkedThrough = new Date(end).toISOString();
        if (!starts.length) continue;
        const earliestAvailableAt = starts[0];
        const businessDays = businessLeadDays(at, earliestAvailableAt, location.timezone, location.calendar);
        return { ...base, status: 'SUCCESS', earliestAvailableAt,
          calendarDays: calendarLeadDays(at, earliestAvailableAt, location.timezone), businessDays,
          businessDayMethod: businessDays === null ? null : 'SOURCE_OPERATING_CALENDAR' };
      }
      return { ...base, status: 'NO_AVAILABILITY', diagnosticCode: 'OPENDOCK_NO_SLOTS_IN_CHECKED_RANGE' };
    } catch (error) {
      if (error instanceof SourceFailure) return { ...base, status: error.status, diagnosticCode: error.diagnosticCode };
      // Never serialize exceptions, response bodies, login payloads or tokens.
      return { ...base, status: 'INVALID_RESPONSE', diagnosticCode: 'OPENDOCK_RESPONSE_FORMAT_CHANGED' };
    }
  }
}
