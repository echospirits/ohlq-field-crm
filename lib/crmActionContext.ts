export type CRMActionContext = {
  agencyId?: string | null;
  wholesaleAccountId?: string | null;
  opportunityId?: string | null;
  agencyProductIntelligenceId?: string | null;
  worklistItemId?: string | null;
  visitId?: string | null;
  productItemCode?: string | null;
  productName?: string | null;
  sourceType?: string | null;
  sourceLabel?: string | null;
  accountName?: string | null;
  reason?: string | null;
  returnTo?: string | null;
};

const clean = (value: string | null | undefined) => value?.trim() || undefined;

export function normalizeCRMActionContext(context: CRMActionContext): CRMActionContext {
  const returnTo = clean(context.returnTo);
  return {
    agencyId: clean(context.agencyId),
    wholesaleAccountId: clean(context.wholesaleAccountId),
    opportunityId: clean(context.opportunityId),
    agencyProductIntelligenceId: clean(context.agencyProductIntelligenceId),
    worklistItemId: clean(context.worklistItemId),
    visitId: clean(context.visitId),
    productItemCode: clean(context.productItemCode),
    productName: clean(context.productName),
    sourceType: clean(context.sourceType),
    sourceLabel: clean(context.sourceLabel),
    accountName: clean(context.accountName),
    reason: clean(context.reason),
    returnTo: returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : undefined,
  };
}

export function getContextualVisitHref(context: CRMActionContext) {
  const value = normalizeCRMActionContext(context);
  const params = new URLSearchParams();
  if (value.agencyId) {
    params.set('type', 'agency');
    params.set('agencyId', value.agencyId);
  } else if (value.wholesaleAccountId) {
    params.set('type', 'wholesale');
    params.set('wholesaleAccountId', value.wholesaleAccountId);
  }
  for (const [key, item] of Object.entries(value)) {
    if (item && !['agencyId', 'wholesaleAccountId'].includes(key)) params.set(key, item);
  }
  return `/visits/new?${params.toString()}`;
}

export function getDirectionsHref(address: string | null | undefined) {
  const destination = clean(address);
  return destination
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
    : null;
}

export function getSuggestedFollowUpTitle(context: CRMActionContext) {
  const value = normalizeCRMActionContext(context);
  if (value.sourceLabel) return `Follow up on ${value.sourceLabel}`.slice(0, 160);
  if (value.productName && value.reason) return `Follow up on ${value.productName} ${value.reason}`.slice(0, 160);
  if (value.productName) return `Follow up on ${value.productName}`.slice(0, 160);
  if (value.accountName) return `Follow up with ${value.accountName}`.slice(0, 160);
  return 'Follow up';
}
