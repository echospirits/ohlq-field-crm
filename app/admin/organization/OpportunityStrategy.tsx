import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/auth';
import { requireFeatureForUser, hasFeature, writeOrganizationAudit } from '../../../lib/organizations';
import { prisma } from '../../../lib/prisma';
import { ActionForm, type ActionResult } from '../../components/ActionForm';
import { SubmitButton } from '../../components/SubmitButton';

async function saveStrategy(form: FormData): Promise<ActionResult> {
  'use server';
  const user = await requireAdmin();
  const { organizationId } = await requireFeatureForUser(user, 'WHOLESALE_OPPORTUNITIES');
  const role = String(form.get('role')), availability = String(form.get('availability'));
  const priority = Number(form.get('priority'));
  if (!['NEUTRAL','FOCUS','OPPORTUNISTIC','MAINTENANCE'].includes(role) || !['UNVERIFIED','AVAILABLE','UNAVAILABLE'].includes(availability) || !Number.isInteger(priority) || priority < 0 || priority > 10) return { error: 'Choose a strategy, availability and priority from 0 to 10.' };
  const product = await prisma.organizationProduct.findFirst({ where: { id: String(form.get('id')), organizationId } });
  if (!product) return { error: 'Product not found in this organization.' };
  await prisma.$transaction([
    prisma.organizationProduct.update({ where: { id: product.id }, data: { opportunityRole: role, distributionStatus: availability, strategicPriority: priority, subcategory: String(form.get('subtype') ?? '').trim() || null } }),
    prisma.wholesaleAccountAssessment.updateMany({ where: { organizationId }, data: { refreshRequestedAt: new Date() } }),
  ]);
  await writeOrganizationAudit(user.id, organizationId, 'PRODUCT_CONFIGURATION_CHANGED', { productId: product.id, opportunityRole: role, distributionStatus: availability, strategicPriority: priority });
  revalidatePath('/admin/organization'); revalidatePath('/opportunities');
  return { success: 'Strategy saved. Current assessments are marked pending and will refresh in the next full daily sweep; an administrator can also run score-only recalculation.' };
}
export async function OpportunityStrategy({ organizationId }: { organizationId: string }) {
  if (!await hasFeature(organizationId, 'WHOLESALE_OPPORTUNITIES')) return null;
  const products = await prisma.organizationProduct.findMany({ where: { organizationId, active: true, discontinued: false, status: { in: ['OWNED','REPRESENTED'] } }, orderBy: [{ market: 'asc' }, { externalItemCode: 'asc' }] });
  return <details className="card"><summary>Wholesale product strategy</summary><p>Focus influences attention; it does not change observed purchases. Maintenance supports existing business. Priority 0 keeps the existing exclusion behavior. Market availability requires confirmation.</p>
    {products.map(p => <details key={p.id} className="compact-details"><summary>{p.displayName ?? p.externalItemCode} · {p.market} · {p.opportunityRole ?? 'Neutral'}</summary>
      <ActionForm action={saveStrategy}><input name="id" type="hidden" value={p.id}/><div className="form-grid"><label>Role<select name="role" defaultValue={p.opportunityRole ?? 'NEUTRAL'}>{['NEUTRAL','FOCUS','OPPORTUNISTIC','MAINTENANCE'].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>Priority (0 excludes)<input type="number" name="priority" min="0" max="10" defaultValue={p.strategicPriority ?? 1}/></label>
      <label>Style/use subtype<input name="subtype" defaultValue={p.subcategory ?? ''} placeholder="Verified style, e.g. light or spiced"/></label>
      <label>Distribution in {p.market}<select name="availability" defaultValue={p.distributionStatus ?? 'UNVERIFIED'}>{['UNVERIFIED','AVAILABLE','UNAVAILABLE'].map(s => <option key={s}>{s}</option>)}</select></label></div><SubmitButton>Save strategy</SubmitButton></ActionForm></details>)}
    {!products.length ? <p>No active included products. Configure product selection first.</p> : null}
  </details>;
}
