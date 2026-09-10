import { requireUser } from '../../../../../lib/auth';
import { requireOrganizationContext } from '../../../../../lib/organizations';
import { getWholesaleOrderForDownload } from '../../../../../lib/wholesaleOrders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [user, { id }] = await Promise.all([requireUser(), params]);
  const { organizationId } = await requireOrganizationContext(user);
  const order = await getWholesaleOrderForDownload({ id, organizationId });
  if (!order) return new Response('Wholesale order not found.', { status: 404 });
  return new Response(new Uint8Array(order.pdfBytes), {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${order.pdfFilename}"`,
      'Content-Type': 'application/pdf',
      'X-Content-Type-Options': 'nosniff',
      'X-Wholesale-Order-Id': order.id,
    },
  });
}
