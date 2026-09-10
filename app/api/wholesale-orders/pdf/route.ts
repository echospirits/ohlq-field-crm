import { OrganizationProductStatus } from '@prisma/client';
import { z } from 'zod';
import { requireUser } from '../../../../lib/auth';
import { generateDirectWholesaleOrderPdf } from '../../../../lib/directWholesaleOrderPdf';
import { calculateDirectWholesaleOrderTotals, fromCurrencyCents, MAX_DIRECT_WHOLESALE_ORDER_LINES, toCurrencyCents } from '../../../../lib/directWholesaleOrders';
import { requireFeatureForUser } from '../../../../lib/organizations';
import { prisma } from '../../../../lib/prisma';
import {
  assertWholesaleOrderTotals,
  findWholesaleOrderRetry,
  hashWholesaleOrderRequest,
  parseWholesaleOrderDate,
  persistGeneratedWholesaleOrder,
  WholesaleOrderLifecycleError,
  type WholesaleOrderSnapshot,
} from '../../../../lib/wholesaleOrders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const requiredText = z.string().trim().min(1).max(240);
const optionalText = z.string().trim().max(240);
const payloadSchema = z.object({
  clientRequestId: z.string().uuid(),
  a3aSignature: optionalText,
  customer: z.object({
    address: requiredText,
    city: requiredText,
    dba: optionalText,
    f2Permit: z.boolean(),
    name: requiredText,
    permitNumber: requiredText,
    phone: optionalText,
    postalCode: requiredText,
    state: z.string().trim().transform((value) => value.toUpperCase()).pipe(z.literal('OH')),
  }),
  customerSignature: optionalText,
  directSaleLocationId: requiredText,
  lines: z.array(z.object({
    itemCode: requiredText.transform((value) => value.toUpperCase()),
    quantityBottles: z.number().int().min(1).max(10000),
    wholesalePrice: z.number().finite().min(0).max(100000),
  })).min(1).max(MAX_DIRECT_WHOLESALE_ORDER_LINES),
  saleDate: z.string().refine((value) => parseWholesaleOrderDate(value) !== null),
  sinTax: z.number().finite().min(0).max(100000),
  wholesaleAccountId: requiredText,
});

const safeFilename = (value: string) => value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 70) || 'wholesale-customer';

const pdfResponse = (order: { id: string; pdfBytes: Uint8Array; pdfFilename: string }, status = 200) => new Response(new Uint8Array(order.pdfBytes), {
  status,
  headers: {
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename="${order.pdfFilename}"`,
    'Content-Type': 'application/pdf',
    'Location': `/wholesale-orders/${order.id}`,
    'X-Wholesale-Order-Id': order.id,
  },
});

export async function POST(request: Request) {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') return new Response('Cross-site PDF requests are not allowed.', { status: 403 });

  const user = await requireUser();
  const { organizationId } = await requireFeatureForUser(user, 'OHIO_DIRECT_WHOLESALE_ORDERS');
  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return new Response('The wholesale order could not be read.', { status: 400 });
  }
  const parsed = payloadSchema.safeParse(rawPayload);
  if (!parsed.success) return new Response('Review the required wholesale-order fields and try again.', { status: 400 });
  const payload = parsed.data;
  if (new Set(payload.lines.map((line) => line.itemCode)).size !== payload.lines.length) {
    return new Response('Each product can appear only once on an order.', { status: 400 });
  }
  const requestHash = hashWholesaleOrderRequest(payload);
  try {
    const retry = await findWholesaleOrderRetry(organizationId, payload.clientRequestId, requestHash);
    if (retry) return pdfResponse(retry);
  } catch (error) {
    if (error instanceof WholesaleOrderLifecycleError && error.code === 'IDEMPOTENCY_CONFLICT') return new Response(error.message, { status: 409 });
    throw error;
  }

  const [account, location, organizationProducts] = await Promise.all([
    prisma.wholesaleAccount.findFirst({ where: { id: payload.wholesaleAccountId, isActive: true, mergedIntoId: null } }),
    prisma.organizationA3aStoreIdentifier.findFirst({
      where: { id: payload.directSaleLocationId, organizationId, market: 'OH', active: true },
    }),
    prisma.organizationProduct.findMany({
      where: {
        organizationId,
        market: 'OH',
        active: true,
        discontinued: false,
        status: { in: [OrganizationProductStatus.OWNED, OrganizationProductStatus.REPRESENTED] },
        externalItemCode: { in: payload.lines.map((line) => line.itemCode) },
      },
      select: { displayName: true, externalItemCode: true },
    }),
  ]);
  if (!account || !location) return new Response('The account or A-3a location is no longer available.', { status: 404 });
  if (!location.name || !location.addressLine1 || !location.city || !location.postalCode) {
    return new Response('The selected A-3a location is missing required seller information.', { status: 400 });
  }
  const productByCode = new Map(organizationProducts.map((product) => [product.externalItemCode.toUpperCase(), product]));
  if (productByCode.size !== new Set(payload.lines.map((line) => line.itemCode.toUpperCase())).size) {
    return new Response('One or more products are not available to this organization.', { status: 403 });
  }
  const brandItems = await prisma.ohlqBrandMasterItem.findMany({
    where: { itemCode: { in: [...productByCode.keys()] } },
    select: { itemCode: true, name: true, vendor: true },
  });
  const brandByCode = new Map(brandItems.map((item) => [item.itemCode.toUpperCase(), item]));
  const lines = payload.lines.map((line) => {
    const itemCode = line.itemCode.toUpperCase();
    const organizationProduct = productByCode.get(itemCode)!;
    const brand = brandByCode.get(itemCode);
    return { ...line, itemCode, wholesalePrice: fromCurrencyCents(toCurrencyCents(line.wholesalePrice)), itemName: brand?.name || organizationProduct.displayName || itemCode, vendor: brand?.vendor?.trim() || '' };
  });

  const pdfInput = {
    ...payload,
    lines,
    seller: {
      addressLine1: [location.addressLine1, location.addressLine2].filter(Boolean).join(', '),
      city: location.city,
      email: location.email || '',
      name: location.dba || location.name,
      phone: location.phone || '',
      postalCode: location.postalCode,
      state: location.state,
      storeId: location.storeId,
    },
  };
  const pdf = await generateDirectWholesaleOrderPdf(pdfInput);
  const totals = calculateDirectWholesaleOrderTotals(lines, payload.sinTax);
  const subtotalCents = totals.lineSubtotals.reduce((sum, value) => sum + toCurrencyCents(value), 0);
  const sinTaxCents = toCurrencyCents(totals.sinTax);
  let totalCents: number;
  try {
    totalCents = assertWholesaleOrderTotals(subtotalCents, sinTaxCents);
  } catch (error) {
    if (error instanceof WholesaleOrderLifecycleError) return new Response(error.message, { status: 400 });
    throw error;
  }
  const customerLabel = payload.customer.dba || payload.customer.name;
  const filename = `${payload.saleDate}-${safeFilename(customerLabel)}-A3a-Wholesale-Sale.pdf`;
  const snapshot: WholesaleOrderSnapshot = {
    version: 1,
    a3aSignature: payload.a3aSignature,
    customerSignature: payload.customerSignature,
    saleDate: payload.saleDate,
    customer: payload.customer,
    seller: pdfInput.seller,
    lines: lines.map((line) => ({ ...line, unitPriceCents: toCurrencyCents(line.wholesalePrice) })),
    totals: { subtotalCents, sinTaxCents, totalCents },
  };
  try {
    const result = await persistGeneratedWholesaleOrder({
      organizationId,
      wholesaleAccountId: payload.wholesaleAccountId,
      directSaleLocationId: payload.directSaleLocationId,
      createdByUserId: user.id,
      clientRequestId: payload.clientRequestId,
      requestHash,
      snapshot,
      pdfBytes: pdf,
      pdfFilename: filename,
    });
    return pdfResponse(result.order, result.created ? 201 : 200);
  } catch (error) {
    if (error instanceof WholesaleOrderLifecycleError && error.code === 'IDEMPOTENCY_CONFLICT') return new Response(error.message, { status: 409 });
    throw error;
  }
}
