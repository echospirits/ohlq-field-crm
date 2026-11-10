import { validDay } from './model';

/** Foreground-safe source settings. Importing configuration must never load
 * browser/provider adapters used only by the background source worker. */
export function ohioSourceConfiguration(settings: unknown) {
  const raw = (settings as { productionForecasting?: { ohio?: { historyStart?: unknown; directInvoices?: unknown } } } | null)?.productionForecasting?.ohio;
  const historyStart = typeof raw?.historyStart === 'string' && validDay(raw.historyStart) ? raw.historyStart : null;
  const directInvoices: 'invoice-date' | 'shipment-only' | null = raw?.directInvoices === 'invoice-date' || raw?.directInvoices === 'shipment-only' ? raw.directInvoices : null;
  return { historyStart, directInvoices };
}
