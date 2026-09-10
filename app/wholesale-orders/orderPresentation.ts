import type { WholesaleOrderFiledSource, WholesaleOrderStatus } from '@prisma/client';

export const orderStatusLabel: Record<WholesaleOrderStatus, string> = {
  PDF_GENERATED: 'PDF Generated',
  SENT: 'Sent',
  FILED: 'Filed',
};

export const filedSourceLabel: Record<WholesaleOrderFiledSource, string> = {
  AUTO_MATCH: 'Matched to OHLQ sales data',
  MANUAL: 'Marked Filed manually',
};

export const formatOrderCurrency = (cents: number) => new Intl.NumberFormat('en-US', { currency: 'USD', style: 'currency' }).format(cents / 100);
