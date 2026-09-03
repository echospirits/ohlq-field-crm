'use client';

import { OrganizationProductStatus } from '@prisma/client';
import { useMemo, useState } from 'react';

type ProductOption = {
  id: string;
  itemCode: string;
  name: string | null;
  status: OrganizationProductStatus;
};

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  organizationId: string;
  products: ProductOption[];
};

const searchableLabel = (product: ProductOption) => `${product.itemCode} ${product.name ?? ''}`.toLowerCase();
const optionLabel = (product: ProductOption) => `${product.itemCode} — ${product.name || 'Name pending'}${product.status === OrganizationProductStatus.PENDING_REVIEW ? ' (new)' : ''}`;

export function ProductSelectionEditor({ action, organizationId, products }: Props) {
  const [includedIds, setIncludedIds] = useState(() => new Set(products.filter((product) => product.status === OrganizationProductStatus.OWNED || product.status === OrganizationProductStatus.REPRESENTED).map((product) => product.id)));
  const [selectedExcluded, setSelectedExcluded] = useState<string[]>([]);
  const [selectedIncluded, setSelectedIncluded] = useState<string[]>([]);
  const [excludedQuery, setExcludedQuery] = useState('');
  const [includedQuery, setIncludedQuery] = useState('');

  const excludedProducts = useMemo(() => products.filter((product) => !includedIds.has(product.id) && searchableLabel(product).includes(excludedQuery.trim().toLowerCase())), [excludedQuery, includedIds, products]);
  const includedProducts = useMemo(() => products.filter((product) => includedIds.has(product.id) && searchableLabel(product).includes(includedQuery.trim().toLowerCase())), [includedIds, includedQuery, products]);
  const pendingCount = products.filter((product) => product.status === OrganizationProductStatus.PENDING_REVIEW).length;

  const includeSelected = () => {
    if (!selectedExcluded.length) return;
    setIncludedIds((current) => new Set([...current, ...selectedExcluded]));
    setSelectedExcluded([]);
  };

  const excludeSelected = () => {
    if (!selectedIncluded.length) return;
    setIncludedIds((current) => {
      const next = new Set(current);
      selectedIncluded.forEach((id) => next.delete(id));
      return next;
    });
    setSelectedIncluded([]);
  };

  return <form action={action} className="product-selection-form">
    <input name="organizationId" type="hidden" value={organizationId} />
    {[...includedIds].map((id) => <input key={id} name="includedProductIds" type="hidden" value={id} />)}
    <div className="product-selection-summary" aria-live="polite">
      <span><strong>{includedIds.size}</strong> included</span>
      <span><strong>{products.length - includedIds.size}</strong> excluded</span>
      {pendingCount ? <span className="product-selection-new"><strong>{pendingCount}</strong> new</span> : null}
    </div>
    <div className="product-transfer-grid">
      <section className="product-transfer-pane">
        <div><strong>Excluded / new</strong><small>Select one or more items to include.</small></div>
        <input aria-label="Search excluded products" onChange={(event) => setExcludedQuery(event.target.value)} placeholder="Filter by item or name" type="search" value={excludedQuery} />
        <select aria-label="Excluded products" multiple onChange={(event) => setSelectedExcluded([...event.currentTarget.selectedOptions].map((option) => option.value))} onDoubleClick={includeSelected} size={12} value={selectedExcluded}>
          {excludedProducts.map((product) => <option key={product.id} title={product.name ?? undefined} value={product.id}>{optionLabel(product)}</option>)}
        </select>
      </section>
      <div className="product-transfer-actions" aria-label="Move products">
        <button className="compact-btn" disabled={!selectedExcluded.length} onClick={includeSelected} type="button"><span aria-hidden="true">→</span><span>Include</span></button>
        <button className="compact-btn secondary" disabled={!selectedIncluded.length} onClick={excludeSelected} type="button"><span aria-hidden="true">←</span><span>Exclude</span></button>
      </div>
      <section className="product-transfer-pane">
        <div><strong>Included</strong><small>These items will be available to the organization.</small></div>
        <input aria-label="Search included products" onChange={(event) => setIncludedQuery(event.target.value)} placeholder="Filter by item or name" type="search" value={includedQuery} />
        <select aria-label="Included products" multiple onChange={(event) => setSelectedIncluded([...event.currentTarget.selectedOptions].map((option) => option.value))} onDoubleClick={excludeSelected} size={12} value={selectedIncluded}>
          {includedProducts.map((product) => <option key={product.id} title={product.name ?? undefined} value={product.id}>{optionLabel(product)}</option>)}
        </select>
      </section>
    </div>
    <div className="product-selection-footer">
      <small>Tip: Ctrl-click or Shift-click to select multiple items. Double-click moves an item immediately.</small>
      <button type="submit">Save product selection</button>
    </div>
  </form>;
}
