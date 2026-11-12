import { createHash } from 'node:crypto';
import type { departments } from './schemas';

export type Department = (typeof departments)[number];
export const normalize = (value: string | null | undefined) => (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
export const fingerprint = (...values: unknown[]) => createHash('sha256').update(JSON.stringify(values)).digest('hex');
export const knownNumber = (value: unknown): number | null => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
export const sameUnit = (a: string | null | undefined, b: string | null | undefined) => Boolean(normalize(a) && normalize(a) === normalize(b));
export const relevantDepartment = (department: string) => department === 'PRODUCTION' || department === 'SHARED';

export type Classification = { department: Department; source: string; confidence: number; explanation: string; catalogItemId?: string };
type Catalog = { id: string; name: string; confirmed: boolean; sharedUse: boolean; departments: string[]; unit?: string | null; packSize?: unknown; productAssociation?: string | null };
type Rule = { supplier: string; sku: string; department: string; unit?: string | null; packSize?: unknown; catalogItemId?: string | null; explanation: string; active: boolean };
export function classifyLine(input: { supplier: string; sku?: string | null; unit?: string | null; packSize?: unknown; manual?: { department: Department; explanation?: string }; catalog?: Catalog | null; rules?: Rule[] }): Classification {
  if (input.manual) return { department: input.manual.department, source: 'MANUAL', confidence: 1, explanation: input.manual.explanation || 'Reviewed for this purchase.' };
  const rule = input.rules?.find(r => r.active && normalize(r.supplier) === normalize(input.supplier) && normalize(r.sku) !== '' && normalize(r.sku) === normalize(input.sku) && (!r.unit || sameUnit(r.unit, input.unit)) && (knownNumber(r.packSize) === null || knownNumber(r.packSize) === knownNumber(input.packSize)));
  if (rule) return { department: rule.department as Department, source: 'REVIEWED_RULE', confidence: 1, explanation: rule.explanation, ...(rule.catalogItemId ? { catalogItemId: rule.catalogItemId } : {}) };
  const catalog = input.catalog;
  if (catalog?.confirmed) {
    if (catalog.sharedUse || catalog.departments.length !== 1) return { department: 'NEEDS_REVIEW', source: 'CATALOG', confidence: 0.5, catalogItemId: catalog.id, explanation: `${catalog.name} serves more than one department. Confirm this purchase's purpose or mark Shared.` };
    if ((catalog.unit && !sameUnit(catalog.unit, input.unit)) || (knownNumber(catalog.packSize) !== null && knownNumber(catalog.packSize) !== knownNumber(input.packSize))) return { department: 'NEEDS_REVIEW', source: 'CATALOG', confidence: 0.5, catalogItemId: catalog.id, explanation: 'Catalog material matched; units or pack size need review.' };
    return { department: catalog.departments[0] as Department, source: 'CATALOG', confidence: 0.95, catalogItemId: catalog.id, explanation: `Confirmed catalog mapping: ${catalog.name}.` };
  }
  return { department: 'NEEDS_REVIEW', source: 'UNKNOWN', confidence: 0, ...(catalog ? { catalogItemId: catalog.id } : {}), explanation: catalog?.productAssociation ? `${catalog.name} is ${catalog.productAssociation}; confirm this purchase's intended department.` : 'Purchase purpose is unknown. Review the individual item.' };
}

export function lineAvailableQuantity(line: { quantity: unknown; department: string; productionQuantity?: unknown; ignored?: boolean; status?: string }) {
  if (line.ignored || line.status === 'CANCELLED' || !relevantDepartment(line.department)) return null;
  return line.department === 'SHARED' ? knownNumber(line.productionQuantity) : knownNumber(line.quantity);
}
export function needCoverage(need: { quantity: unknown; unit?: string | null; resolvedAt?: unknown; allocations: Array<{ id?: string; quantity: unknown; receivedQuantity?: unknown; unit?: string | null; line: { id?: string; quantity: unknown; department: string; productionQuantity?: unknown; ignored?: boolean; unit?: string | null; receiptLines?: Array<{ quantity: unknown; damagedQuantity?: unknown; unit: string }>; allocations?: Array<{ id: string; quantity: unknown; receivedQuantity: unknown }>; order: { status: string; shipments?: Array<{ status: string; lines?: Array<{ lineId: string }> }> } } }> }) {
  const required = knownNumber(need.quantity);
  let allocated = 0, received = 0, unknown = false, incoming = false;
  for (const allocation of need.allocations) {
    const line = allocation.line, quantity = knownNumber(allocation.quantity);
    if (line.ignored || line.order.status === 'IGNORED') continue;
    const shipments = line.order.shipments?.filter(s => !s.lines?.length || s.lines.some(l => l.lineId === line.id));
    const unavailable = line.order.status === 'CANCELLED' || Boolean(shipments?.length && shipments.every(s => ['RETURNED', 'CANCELLED'].includes(s.status)));
    if (unavailable) {
      // A returned remainder cannot erase materials the team already confirmed.
      const confirmed = Math.min(quantity ?? Infinity, knownNumber(allocation.receivedQuantity) ?? 0);
      if (confirmed && sameUnit(allocation.unit, need.unit) && sameUnit(line.unit, need.unit)) { received += confirmed; allocated += confirmed; }
      else if (confirmed) unknown = true;
      continue;
    }
    if (quantity === null || !sameUnit(allocation.unit, need.unit) || !sameUnit(line.unit, need.unit) || lineAvailableQuantity(line) === null) { unknown = true; continue; }
    const receivedForNeed = Math.min(quantity, knownNumber(allocation.receivedQuantity) ?? 0);
    if (line.department === 'SHARED' && line.receiptLines?.length) {
      const gross = line.receiptLines.reduce((sum, r) => sum + (knownNumber(r.quantity) ?? 0), 0), damaged = line.receiptLines.reduce((sum, r) => sum + (knownNumber(r.damagedQuantity) ?? 0), 0);
      if (knownNumber(line.quantity) === null || gross < Number(line.quantity) || damaged > 0) unknown = true;
    }
    let effective = quantity;
    if (line.order.status === 'RECEIVED') effective = receivedForNeed;
    else if (line.receiptLines?.length) {
      const grossReceived = line.receiptLines.filter(r => sameUnit(r.unit, line.unit)).reduce((sum, r) => sum + (knownNumber(r.quantity) ?? 0), 0);
      const pending = Math.max(0, (lineAvailableQuantity(line) ?? 0) - grossReceived);
      const position = line.allocations?.findIndex(a => a.id === allocation.id) ?? -1;
      const priorOutstanding = position < 0 ? 0 : line.allocations!.slice(0, position).reduce((sum, a) => sum + Math.max(0, (knownNumber(a.quantity) ?? 0) - (knownNumber(a.receivedQuantity) ?? 0)), 0);
      effective = receivedForNeed + Math.min(Math.max(0, quantity - receivedForNeed), Math.max(0, pending - priorOutstanding));
    }
    allocated += effective;
    received += receivedForNeed;
    incoming ||= Boolean(shipments?.some(s => ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELAYED', 'PICKUP_REQUIRED'].includes(s.status)));
  }
  const coverage = required === null || unknown ? 'UNKNOWN' : allocated >= required ? 'ADEQUATE' : allocated > 0 ? 'PARTIAL' : 'NONE';
  const stage = need.resolvedAt ? 'RESOLVED' : required !== null && received >= required ? 'RECEIVED' : allocated > 0 ? incoming ? 'INCOMING' : 'ORDERED' : 'NEEDS_ORDER';
  return { required, allocated, received, outstanding: required === null ? null : Math.max(0, required - received), coverage, stage, unknown };
}

export function validateAllocation(input: { lineQuantity: unknown; alreadyAllocated: unknown; quantity: unknown; lineUnit?: string | null; needUnit?: string | null; unit?: string | null }) {
  const quantity = knownNumber(input.quantity), available = knownNumber(input.lineQuantity), already = knownNumber(input.alreadyAllocated) ?? 0;
  if (quantity === null) return;
  if (!sameUnit(input.lineUnit, input.needUnit) || !sameUnit(input.unit, input.needUnit)) throw new Error('Quantified coverage requires matching, known units. Link without quantity when coverage is unknown.');
  if (available === null) throw new Error('Confirm the production quantity before allocating it.');
  if (quantity + already > available + 0.000001) throw new Error('This quantity is already allocated or exceeds the available production quantity.');
}
export function selectArrival<T extends { source: string; current: boolean; startDate: string; observedAt: Date | string; sourceEventAt?: Date | string }>(estimates: T[]): T | null {
  const priority = ['APPOINTMENT', 'CARRIER', 'SUPPLIER_PROMISE', 'MANUAL', 'PREDICTION'];
  const rank = (source: string) => priority.includes(source) ? priority.indexOf(source) : priority.length;
  return estimates.filter(e => e.current).sort((a, b) => rank(a.source) - rank(b.source) || new Date(b.sourceEventAt ?? b.observedAt).getTime() - new Date(a.sourceEventAt ?? a.observedAt).getTime())[0] ?? null;
}
