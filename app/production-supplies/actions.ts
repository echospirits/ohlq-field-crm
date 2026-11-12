'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireSupplyActor } from '../../lib/productionSupplies/access';
import * as supplies from '../../lib/productionSupplies/service';
import { refreshSupplyShipmentTracking } from '../../lib/productionSupplies/tracking';
import type { ActionResult } from '../components/ActionForm';

const value = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const fields = (form: FormData) => Object.fromEntries(form.entries());
function indexed(form: FormData, keys: string[]) {
  return form.getAll(keys[0]).map((_, index) => Object.fromEntries(keys.map(key => [key.replace(/^line\./, ''), String(form.getAll(key)[index] ?? '').trim()])));
}
function refresh() { revalidatePath('/production-supplies', 'layout'); }
async function mutate(run: (actor: Awaited<ReturnType<typeof requireSupplyActor>>['actor']) => Promise<unknown>, success: string): Promise<ActionResult> {
  const { actor } = await requireSupplyActor(true);
  try {
    await run(actor);
    refresh();
    return { success };
  } catch (error) {
    if (error instanceof z.ZodError) return { error: error.issues.map(issue => issue.message).join(' ') };
    // Domain failures are safe, deliberately user-readable validation messages.
    if (error instanceof Error && (error.name === 'SupplyError' || error.name === 'ProductionSupplyError')) return { error: error.message };
    return { error: 'Could not save this change. Refresh the record, check the values, and try again.' };
  }
}
export async function createOrderAction(form: FormData) {
  return mutate(actor => supplies.createManualOrder(actor, { ...fields(form), lines: indexed(form, ['line.description', 'line.quantity', 'line.unit', 'line.sku', 'line.department', 'line.catalogItemId']).filter(line => line.description) }), 'Order saved.');
}
export async function createNeedAction(form: FormData) { return mutate(actor => supplies.createNeed(actor, fields(form)), 'Supply need saved.'); }
export async function classifyLineAction(form: FormData) { return mutate(actor => supplies.updateLineClassification(actor, { ...fields(form), remember: form.get('remember') === 'on' }), 'Purchase classification saved.'); }
export async function linkNeedAction(form: FormData) { return mutate(actor => supplies.linkNeed(actor, fields(form)), 'Replenishment linked.'); }
export async function unlinkNeedAction(form: FormData) { return mutate(actor => supplies.unlinkNeed(actor, fields(form)), 'Replenishment link removed.'); }
export async function recordReceiptAction(form: FormData) {
  return mutate(actor => supplies.recordReceipt(actor, { ...fields(form), lines: indexed(form, ['line.lineId', 'line.quantity', 'line.unit', 'line.shortageQuantity', 'line.damagedQuantity', 'line.notes']).filter(line => Number(line.quantity) > 0 || Number(line.shortageQuantity) > 0) }), 'Receipt recorded. Related needs remain open until explicitly resolved.');
}
export async function addNoteAction(form: FormData) { return mutate(actor => supplies.addNote(actor, fields(form)), 'Note saved.'); }
export async function assignOwnerAction(form: FormData) { return mutate(actor => supplies.assignOwner(actor, fields(form)), 'Owner saved.'); }
export async function resolveNeedAction(form: FormData) { return mutate(actor => supplies.resolveNeed(actor, fields(form)), 'Supply need resolved.'); }
export async function attachTrackingAction(form: FormData) { return mutate(async actor => {
  const lines = form.getAll('shipmentLineIds').map(lineId => ({ lineId: String(lineId), quantity: value(form, `shipmentQuantity.${lineId}`) }));
  const shipment = await supplies.attachTracking(actor, { ...fields(form), lines });
  // The saved reference remains queued if the immediate provider request fails.
  try { await refreshSupplyShipmentTracking(actor.organizationId, shipment.id); } catch { /* scheduled reconciliation retries */ }
}, 'Shipping reference saved; automatic tracking is queued.'); }
export async function ignoreSupplyAction(form: FormData) { return mutate(actor => supplies.ignoreSupply(actor, { ...fields(form), ignored: form.get('ignored') !== 'false' }), 'Supply visibility saved.'); }
export async function saveExpectationAction(form: FormData) { return mutate(actor => supplies.saveArrivalExpectation(actor, Object.fromEntries([...form.entries()].filter(([, entry]) => String(entry).trim() !== ''))), 'Arrival expectation saved with its source.'); }
export async function saveRuleAction(form: FormData) { return mutate(actor => supplies.saveClassificationRule(actor, { ...fields(form), active: form.get('active') === 'on' }), 'Specific supplier and SKU rule saved.'); }
export async function updateLineAction(form: FormData) { return mutate(actor => supplies.updateLineDetails(actor, fields(form)), 'Order line corrected.'); }
export async function updateOrderAction(form: FormData) { return mutate(actor => supplies.updateOrderDetails(actor, Object.fromEntries([...form.entries()].filter(([key, entry]) => !['orderedAt', 'status'].includes(key) || String(entry).trim() !== ''))), 'Order details corrected.'); }
export async function reviewSourceAction(form: FormData) { return mutate(actor => supplies.reviewSupplySource(actor, fields(form)), 'Source review saved for this message.'); }
export async function updateNeedAction(form: FormData) { return mutate(actor => supplies.updateNeedDetails(actor, { ...fields(form), blocked: form.get('blocked') === 'on', reviewRequired: form.get('reviewRequired') === 'on' }), 'Supply need details saved.'); }
export async function refreshTrackingAction(form: FormData): Promise<ActionResult> {
  const { actor } = await requireSupplyActor(true);
  const shipmentId = z.string().min(1).max(120).safeParse(value(form, 'shipmentId'));
  if (!shipmentId.success) return { error: 'Choose a shipment to refresh.' };
  try {
    const result = await refreshSupplyShipmentTracking(actor.organizationId, shipmentId.data, undefined, { manual: true });
    refresh();
    if (result.status === 'failed' || result.status === 'rate_limited' || result.status === 'busy') return { error: result.message ?? 'Tracking could not be refreshed yet. The last valid result is retained.' };
    return { success: result.message ?? 'Tracking checked.' };
  } catch { return { error: 'Tracking could not be refreshed. The last valid result is retained.' }; }
}
export async function saveCatalogAction(form: FormData) {
  return mutate(actor => supplies.saveCatalogItem(actor, { ...fields(form), departments: form.getAll('departments'), aliases: value(form, 'aliases').split(/[\n,]/).map(alias => alias.trim()).filter(Boolean), sharedUse: form.get('sharedUse') === 'on' }), 'Catalog item saved.');
}
