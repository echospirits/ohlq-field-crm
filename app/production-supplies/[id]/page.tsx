import { redirect } from 'next/navigation';
import { requireSupplyActor } from '../../../lib/productionSupplies/access';

export default async function SupplyDetailPage() {
  await requireSupplyActor();
  redirect('/production-supplies');
}
