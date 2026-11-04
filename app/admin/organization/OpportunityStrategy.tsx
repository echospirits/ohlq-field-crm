import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/auth';
import { requireFeatureForUser, hasFeature, writeOrganizationAudit } from '../../../lib/organizations';
import { prisma } from '../../../lib/prisma';
import { ActionForm, type ActionResult } from '../../components/ActionForm';
import { AnchoredDetails } from '../../components/AnchoredDetails';
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
  const subtype = String(form.get('subtype') ?? '').trim() || null;
  const commercialInputsChanged = subtype !== product.subcategory || (priority === 0) !== (product.strategicPriority === 0);
  await prisma.$transaction([
    prisma.organizationProduct.update({ where: { id: product.id }, data: { opportunityRole: role, distributionStatus: availability, strategicPriority: priority, subcategory: subtype } }),
    ...(commercialInputsChanged ? [prisma.wholesaleAccountAssessment.updateMany({ where: { organizationId }, data: { refreshRequestedAt: new Date() } })] : []),
  ]);
  await writeOrganizationAudit(user.id, organizationId, 'PRODUCT_CONFIGURATION_CHANGED', { productId: product.id, opportunityRole: role, distributionStatus: availability, strategicPriority: priority });
  revalidatePath('/admin/organization'); revalidatePath('/opportunities');
  return { success: commercialInputsChanged ? 'Product inclusion or style changed. Commercial ratings will recalculate during the next full daily sweep.' : 'Execution preferences saved. Commercial stars are unchanged.' };
}
export async function OpportunityStrategy({ organizationId }: { organizationId: string }) {
  if (!await hasFeature(organizationId, 'WHOLESALE_OPPORTUNITIES')) return null;
  const products = await prisma.organizationProduct.findMany({ where: { organizationId, active: true, discontinued: false, status: { in: ['OWNED','REPRESENTED'] } }, orderBy: [{ market: 'asc' }, { externalItemCode: 'asc' }] });
  return <section className="workspace-section"><h2>Restaurant product strategy</h2><p className="muted">Execution preferences · priority 0 excludes a product · other priorities do not multiply commercial stars</p>
    {products.length ? <div className="table-scroll" role="region" aria-label="Current restaurant product strategies" tabIndex={0}><table className="comparison-table strategy-summary-table"><thead><tr><th scope="col">Product</th><th scope="col">Role</th><th scope="col" className="numeric">Priority</th><th scope="col">Verified style</th><th scope="col">Distribution</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{products.map(p => <tr key={p.id}><th scope="row">{p.displayName ?? p.externalItemCode}<small>{p.market} · {p.externalItemCode}</small></th><td>{p.opportunityRole ?? 'NEUTRAL'}</td><td className="numeric">{p.strategicPriority ?? 1}</td><td>{p.subcategory || 'Unverified'}</td><td>{p.distributionStatus ?? 'UNVERIFIED'}</td><td><a href={`#strategy-${p.id}`}>Edit strategy</a></td></tr>)}</tbody></table></div> : null}
    <div className="strategy-edit-list">
    {products.map(p => <AnchoredDetails key={p.id} id={`strategy-${p.id}`} className="compact-details" summary={`Edit ${p.displayName ?? p.externalItemCode} strategy · ${p.market}`}>
      <ActionForm action={saveStrategy}><input name="id" type="hidden" value={p.id}/><div className="form-grid"><label>Role<select name="role" defaultValue={p.opportunityRole ?? 'NEUTRAL'}>{['NEUTRAL','FOCUS','OPPORTUNISTIC','MAINTENANCE'].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>Priority (0 excludes)<input type="number" name="priority" min="0" max="10" defaultValue={p.strategicPriority ?? 1}/></label>
      <label>Style/use subtype<input name="subtype" defaultValue={p.subcategory ?? ''} placeholder="Verified style, e.g. light or spiced"/></label>
      <label>Distribution in {p.market}<select name="availability" defaultValue={p.distributionStatus ?? 'UNVERIFIED'}>{['UNVERIFIED','AVAILABLE','UNAVAILABLE'].map(s => <option key={s}>{s}</option>)}</select></label></div><SubmitButton>Save strategy</SubmitButton></ActionForm></AnchoredDetails>)}
    {!products.length ? <p>No active included products. Configure product selection first.</p> : null}
    </div>
  </section>;
}
