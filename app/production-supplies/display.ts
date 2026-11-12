export const departmentLabels: Record<string, string> = { PRODUCTION: 'Production', BAR: 'Bar', SHARED: 'Shared', OTHER: 'Other', NEEDS_REVIEW: 'Needs review' };
export const statusLabels: Record<string, string> = {
  NEEDS_ORDER: 'Needs order', ORDERED: 'Ordered', INCOMING: 'Incoming', RECEIVED: 'Received', RESOLVED: 'Resolved', CANCELLED: 'Cancelled',
  LABEL_CREATED: 'Label created', IN_TRANSIT: 'In transit', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered',
  PICKUP_REQUIRED: 'Pickup required', DELAYED: 'Delayed', RETURNED: 'Returned to sender', UNKNOWN: 'Status unknown', BACKORDERED: 'Backordered',
};
export const displayStatus = (status: string) => statusLabels[status] ?? status.toLowerCase().replaceAll('_', ' ');
export type Arrival = { source: string; precision: string; startDate: string; endDate?: string | null; timeStart?: string | null; timeEnd?: string | null; timezone: string; current: boolean; observedAt: string | Date; sourceEventAt: string | Date };
export function currentArrival(estimates: Arrival[]) {
  const priority: Record<string, number> = { APPOINTMENT: 0, CARRIER: 1, CARRIER_ESTIMATE: 1, SUPPLIER_PROMISE: 2, SUPPLIER: 2, MANUAL: 3, MANUAL_EXPECTATION: 3, PREDICTION: 4, PROVIDER_PREDICTION: 4 };
  return estimates.filter(item => item.current).sort((a, b) => (priority[a.source] ?? 5) - (priority[b.source] ?? 5) || new Date(b.sourceEventAt).getTime() - new Date(a.sourceEventAt).getTime())[0];
}
export function arrivalText(arrival: Arrival | undefined) {
  if (!arrival) return 'No ETA available';
  const date = shortDate(arrival.startDate);
  const end = arrival.endDate && arrival.endDate !== arrival.startDate ? ` – ${shortDate(arrival.endDate)}` : '';
  const time = arrival.timeStart ? ` · ${arrival.timeStart}${arrival.timeEnd ? `–${arrival.timeEnd}` : ''} ${arrival.timezone}` : '';
  return `${date}${end}${time}`;
}
export function arrivalSource(source: string) { return ({ APPOINTMENT: 'Delivery appointment', CARRIER: 'Carrier estimate', CARRIER_ESTIMATE: 'Carrier estimate', PREDICTION: 'Provider prediction', PROVIDER_PREDICTION: 'Provider prediction', SUPPLIER_PROMISE: 'Supplier promise', SUPPLIER: 'Supplier schedule', MANUAL: 'Manual expectation', MANUAL_EXPECTATION: 'Manual expectation' } as Record<string, string>)[source] ?? source.toLowerCase().replaceAll('_', ' '); }
export function quantityText(value: unknown, unit?: string | null) { return value === null || value === undefined || value === '' ? 'Quantity unknown' : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })}${unit ? ` ${unit}` : ' · unit unknown'}`; }
export function warningFactsText({ reportedQuantity, reportedThreshold, unit }: { reportedQuantity?: number | null; reportedThreshold?: number | null; unit?: string | null }) {
  const known = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isFinite(value);
  const amount = (value: number) => `${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}${unit?.trim() ? ` ${unit.trim()}` : ''}`;
  const facts = [known(reportedQuantity) ? `reported ${amount(reportedQuantity)}` : null, known(reportedThreshold) ? `threshold ${amount(reportedThreshold)}` : null].filter(Boolean);
  return facts.length ? `Last warning ${facts.join(' · ')}` : null;
}
export function warningSourceLabel(source: string) { return ({ DISTILLX5_EMAIL: 'Distillx5 email', OTHER_EMAIL: 'Email' } as Record<string, string>)[source] ?? source.toLowerCase().replaceAll('_', ' '); }
export function ownedGmailSourceUrl(source: { provider: string; userId: string | null; messageId: string }, viewer: { id: string; email: string }) {
  if (source.userId !== viewer.id || !['GOOGLE', 'GOOGLE_CONNECTOR'].includes(source.provider) || !source.messageId) return null;
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(viewer.email)}#all/${encodeURIComponent(source.messageId)}`;
}
export function shortDate(value: string | Date | null | undefined) {
  if (!value) return 'Unknown';
  const source = value instanceof Date ? value.toISOString() : value;
  const date = new Date(`${source.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? 'Unknown' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}
export function observed(value: string | Date | null | undefined) {
  if (!value) return 'Never checked';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Check time unknown' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(date) + ' ET';
}
export function safeReturnTo(value: string | undefined) { return value?.startsWith('/production-supplies?') || value === '/production-supplies' ? value : '/production-supplies'; }
export function supplyHref(params: Record<string, string | undefined>, patch: Record<string, string | undefined> = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...patch })) if (value) query.set(key, value);
  return `/production-supplies${query.size ? `?${query}` : ''}`;
}
