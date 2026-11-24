import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '../../../lib/auth';
import { requireFeatureForUser, hasFeature } from '../../../lib/organizations';
import { prisma } from '../../../lib/prisma';
import { isRestaurantProductRestricted, loadRestaurantProductRestrictions } from '../../../lib/restaurantProductEligibility';
import { ActionForm, type ActionResult } from '../../components/ActionForm';
import { AnchoredDetails } from '../../components/AnchoredDetails';
import { SubmitButton } from '../../components/SubmitButton';

const editableProduct = {
  active: true,
  discontinued: false,
  status: { in: ['OWNED', 'REPRESENTED'] },
} satisfies Prisma.OrganizationProductWhereInput;

const distributionLabels = {
  UNVERIFIED: 'Unverified',
  AVAILABLE: 'Available',
  UNAVAILABLE: 'Unavailable',
} as const;

const strategyInput = z.object({
  id: z.string().trim().min(1),
  inclusion: z.enum(['include', 'exclude']),
  availability: z.enum(['UNVERIFIED', 'AVAILABLE', 'UNAVAILABLE']),
  subtype: z.string().trim(),
});

async function saveStrategy(form: FormData): Promise<ActionResult> {
  'use server';
  const user = await requireAdmin();
  const { organizationId } = await requireFeatureForUser(user, 'WHOLESALE_OPPORTUNITIES');
  const parsed = strategyInput.safeParse({
    id: form.get('id'),
    inclusion: form.get('inclusion'),
    availability: form.get('availability'),
    subtype: form.get('subtype'),
  });
  if (!parsed.success) return { error: 'Choose whether to include this product and select its distribution status.' };

  const { id, inclusion, availability, subtype } = parsed.data;
  const included = inclusion === 'include';
  const result = await prisma.$transaction(async tx => {
    const [product, restrictedCodes] = await Promise.all([
      tx.organizationProduct.findFirst({ where: { id, organizationId, ...editableProduct } }),
      loadRestaurantProductRestrictions(organizationId, tx),
    ]);
    if (!product || isRestaurantProductRestricted(product.externalItemCode, restrictedCodes)) {
      return { error: 'This product is no longer eligible for Restaurant Opportunities. Reload Echo Settings for the current list.' };
    }

    const wasIncluded = product.strategicPriority !== 0;
    const subcategory = subtype || null;
    const priority = included ? wasIncluded ? product.strategicPriority : 1 : 0;
    const refreshNeeded = included !== wasIncluded || (included && subcategory !== product.subcategory);
    await tx.organizationProduct.update({
      where: { id: product.id },
      data: { strategicPriority: priority, subcategory, distributionStatus: availability },
    });
    if (refreshNeeded) {
      await tx.wholesaleAccountAssessment.updateMany({ where: { organizationId }, data: { refreshRequestedAt: new Date() } });
    }
    await tx.organizationAuditEvent.create({
      data: {
        actorUserId: user.id,
        organizationId,
        action: 'PRODUCT_CONFIGURATION_CHANGED',
        metadata: { productId: product.id, includedInRestaurantOpportunities: included, strategicPriority: priority, subcategory, distributionStatus: availability },
      },
    });
    return { success: refreshNeeded ? 'Product strategy saved. Commercial ratings will update on the next refresh.' : 'Product strategy saved.' };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if ('success' in result) {
    revalidatePath('/admin/organization');
    revalidatePath('/opportunities');
  }
  return result;
}

export async function OpportunityStrategy({ organizationId }: { organizationId: string }) {
  if (!await hasFeature(organizationId, 'WHOLESALE_OPPORTUNITIES')) return null;
  const [products, restrictedCodes] = await Promise.all([
    prisma.organizationProduct.findMany({
      where: { organizationId, ...editableProduct },
      orderBy: [{ market: 'asc' }, { externalItemCode: 'asc' }],
    }),
    loadRestaurantProductRestrictions(organizationId),
  ]);
  const eligibleProducts = products.filter(product => !isRestaurantProductRestricted(product.externalItemCode, restrictedCodes));

  return <section className="workspace-section" aria-labelledby="restaurant-strategy-title">
    <h2 id="restaurant-strategy-title">Restaurant product strategy</h2>
    <p className="muted">Choose which products count toward Restaurant Opportunities. Verified style helps Neat match comparable products.</p>
    {eligibleProducts.length ? <div className="strategy-edit-list">
      {eligibleProducts.map(product => {
        const name = product.displayName ?? product.externalItemCode;
        const included = product.strategicPriority !== 0;
        const distribution = product.distributionStatus as keyof typeof distributionLabels | null;
        return <AnchoredDetails key={product.id} id={`strategy-${product.id}`} className="compact-details" summary={<>
          <span className="strategy-product-name">
            {name}
            <small>{product.market} · {product.externalItemCode}{product.subcategory ? ` · ${product.subcategory}` : ''}</small>
          </span>
          <span>{included ? 'Included' : 'Excluded'}</span>
        </>}>
          <ActionForm action={saveStrategy}>
            <input name="id" type="hidden" value={product.id} />
            <div className="form-grid">
              <label>Use in Restaurant Opportunities
                <select name="inclusion" defaultValue={included ? 'include' : 'exclude'}>
                  <option value="include">Include product</option>
                  <option value="exclude">Exclude product</option>
                </select>
              </label>
              <label>Verified style
                <input name="subtype" defaultValue={product.subcategory ?? ''} placeholder="e.g. light or spiced" />
              </label>
              <label>Distribution in {product.market}
                <select name="availability" defaultValue={distribution && distribution in distributionLabels ? distribution : 'UNVERIFIED'}>
                  {Object.entries(distributionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>
            <SubmitButton>Save strategy</SubmitButton>
          </ActionForm>
        </AnchoredDetails>;
      })}
    </div> : <p>No eligible restaurant products. Review Product selection below.</p>}
  </section>;
}
