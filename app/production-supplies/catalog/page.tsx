import { redirect } from 'next/navigation';
import { requireSupplyActor } from '../../../lib/productionSupplies/access';

export default async function CatalogPage() {
  await requireSupplyActor();
  redirect('/production-supplies');
}
