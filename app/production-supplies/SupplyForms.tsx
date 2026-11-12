'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionForm } from '../components/ActionForm';
import { SubmitButton } from '../components/SubmitButton';
import { RecordPicker } from '../components/RecordPicker';
import { createNeedAction, createOrderAction, saveCatalogAction } from './actions';
import { departmentLabels } from './display';

export type PickOption = { value: string; label: string };
export function NewOrderForm({ owners, catalog, initialKey }: { owners: PickOption[]; catalog: PickOption[]; initialKey: string }) {
  const [lines, setLines] = useState([0]);
  const [key, setKey] = useState(initialKey);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  if (saved) return <p role="status">Order saved. <a href="/production-supplies">View incoming supplies</a> or <button className="secondary" onClick={() => { setSaved(false); setLines([0]); setKey(crypto.randomUUID()); }}>Add another order</button></p>;
  return <ActionForm action={createOrderAction} className="supply-edit-form" onSuccess={() => { setSaved(true); router.refresh(); }}>
    <input type="hidden" name="idempotencyKey" value={key} />
    <div className="form-grid"><label>Supplier<input name="supplier" required maxLength={300} /></label><label>Order reference<input name="orderReference" maxLength={300} /></label><label>Destination<input name="destination" maxLength={300} /></label><label>Order placed on<input name="orderedAt" type="date" /></label><RecordPicker name="ownerUserId" label="Responsible person" options={owners} clearLabel="Unassigned" placeholder="Unassigned" /></div>
    <h3>Supply lines</h3>
    {lines.map((id, index) => <fieldset className="supply-line-input" key={id}><legend>Line {index + 1}</legend><div className="form-grid"><label>Item description<input name="line.description" required maxLength={300} /></label><label>Vendor SKU<input name="line.sku" maxLength={300} /></label><label>Ordered quantity<input name="line.quantity" type="number" min="0" step="any" /></label><label>Unit<input name="line.unit" placeholder="lb, each, case…" maxLength={300} /></label><label>Department<select name="line.department" defaultValue="NEEDS_REVIEW">{Object.entries(departmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><RecordPicker label={`Catalog item for line ${index + 1}`} name="line.catalogItemId" options={catalog} placeholder="Unmapped item" clearLabel="Unmapped item" /></div></fieldset>)}
    <div className="supply-actions"><button className="secondary" type="button" disabled={lines.length >= 100} onClick={() => setLines(previous => [...previous, Math.max(...previous) + 1])}>Add line</button>{lines.length > 1 ? <button className="secondary" type="button" onClick={() => setLines(previous => previous.slice(0, -1))}>Remove last line</button> : null}</div>
    <label>Notes<textarea name="notes" rows={2} maxLength={4000} /></label><SubmitButton pendingLabel="Saving order…">Save order</SubmitButton>
  </ActionForm>;
}
export function NewNeedForm({ owners, catalog, initialKey }: { owners: PickOption[]; catalog: PickOption[]; initialKey: string }) {
  const [key] = useState(initialKey);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  if (saved) return <p role="status">Supply need saved. <a href="/production-supplies?view=ordering">View needs ordering</a></p>;
  return <ActionForm action={createNeedAction} className="supply-edit-form" onSuccess={() => { setSaved(true); router.refresh(); }}>
    <input type="hidden" name="idempotencyKey" value={key} /><div className="form-grid"><label>Material or supply<input name="description" required maxLength={300} /></label><RecordPicker name="catalogItemId" label="Catalog item" options={catalog} placeholder="Unmapped material" clearLabel="Unmapped material" /><label>Needed at<input name="location" required maxLength={300} /></label><label>Quantity needed<input name="quantity" type="number" min="0" step="any" /></label><label>Unit<input name="unit" maxLength={300} /></label><label>Priority<select name="priority" defaultValue="NORMAL"><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label><RecordPicker name="ownerUserId" label="Responsible person" options={owners} placeholder="Unassigned" clearLabel="Unassigned" /></div><label>Notes<textarea name="notes" rows={2} maxLength={4000} /></label><SubmitButton pendingLabel="Saving need…">Save supply need</SubmitButton>
  </ActionForm>;
}
type CatalogItem = { id: string; name: string; category: string | null; unit: string | null; packSize: number | null; departments: string[]; sharedUse: boolean; productAssociation: string | null; aliases: Array<{ alias: string }> };
export function CatalogForm({ item }: { item?: CatalogItem }) {
  const router = useRouter();
  return <ActionForm action={saveCatalogAction} className="supply-edit-form" onSuccess={() => router.refresh()}>{item ? <input name="id" value={item.id} type="hidden" /> : null}<div className="form-grid"><label>Canonical name<input name="name" required maxLength={300} defaultValue={item?.name} /></label><label>Category<input name="category" maxLength={300} defaultValue={item?.category ?? ''} /></label><label>Unit<input name="unit" maxLength={300} defaultValue={item?.unit ?? ''} /></label><label>Pack size<input name="packSize" type="number" min="0" step="any" defaultValue={item?.packSize ?? ''} /></label><label>Product association<input name="productAssociation" maxLength={300} defaultValue={item?.productAssociation ?? ''} /></label></div><fieldset><legend>Usual departments</legend><div className="supply-actions">{Object.entries(departmentLabels).filter(([key]) => key !== 'NEEDS_REVIEW').map(([value, label]) => <label className="supply-check" key={value}><input type="checkbox" name="departments" value={value} defaultChecked={item ? item.departments.includes(value) : value === 'PRODUCTION'} />{label}</label>)}</div></fieldset><label className="supply-check"><input type="checkbox" name="sharedUse" defaultChecked={item?.sharedUse} />Also used by other departments · purchase purpose still needs review</label><label>Aliases, separated by commas<textarea name="aliases" rows={2} maxLength={4000} defaultValue={item?.aliases.map(alias => alias.alias).join(', ')} /></label><SubmitButton>Save catalog item</SubmitButton></ActionForm>;
}
