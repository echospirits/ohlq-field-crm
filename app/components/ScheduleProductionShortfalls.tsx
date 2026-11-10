import Link from 'next/link';
import type { UserRole } from '@prisma/client';
import { ECHO_ORGANIZATION_ID } from '../../lib/echoAccess';
import { isAdminRole } from '../../lib/userAccess';
import { caseBalance, caseQuantity, cases } from '../../lib/productionForecasting/presentation';
import { getWarehouseBalanceSignals, type WarehouseBalanceSignal } from '../../lib/productionForecasting/operationalSignals/warehouseBalance';

type WarehouseBalances = { today: string; rows: WarehouseBalanceSignal[] };
type Props = { organizationId: string; role: UserRole; enabled: boolean; returnTo: string };
const warehouses = ['GPT', 'GRN'] as const;

export function canViewScheduleProductionShortfalls({ organizationId, role, enabled }: Omit<Props, 'returnTo'>) {
  return enabled && organizationId === ECHO_ORGANIZATION_ID && (isAdminRole(role) || role === 'USER');
}

export function ScheduleProductionShortfallsLoading() {
  return <section className="schedule-production-shortfalls" aria-label="Warehouse shortfalls" aria-busy="true"><p className="record-meta" role="status">Checking warehouse shortfalls…</p></section>;
}

export function ProductionShortfallList({ data, returnTo }: { data: WarehouseBalances; returnTo: string }) {
  const shortfalls = data.rows.flatMap(product => warehouses.flatMap(warehouse => {
    const balance = product.warehouses[warehouse];
    return balance.status === 'AVAILABLE' && balance.balanceCases !== null && balance.balanceCases < 0
      ? [{ product, warehouse, ...balance }]
      : [];
  }));
  const unavailable = data.rows.reduce((count, product) => count + warehouses.filter(warehouse => product.warehouses[warehouse].status !== 'AVAILABLE').length, 0);
  const unassignedDemand = data.rows.reduce((total, product) => {
    const demand = product.demand, amount = demand.byWarehouse.UNASSIGNED;
    const current = demand.status === 'AVAILABLE' && !demand.stale && demand.businessDate === data.today && demand.sourceFreshness === 'CURRENT';
    return total + (current && amount !== null && Number.isFinite(amount) && amount > 0 ? amount : 0);
  }, 0);
  const detailHref = (productId: string) => `/analytics/production/${encodeURIComponent(productId)}?${new URLSearchParams({ horizon: '30', returnTo })}`;
  return <section className="schedule-production-shortfalls" aria-labelledby="schedule-shortfalls-title">
    <div className="section-heading schedule-shortfalls-heading"><h2 id="schedule-shortfalls-title">Warehouse shortfalls</h2><Link href="/analytics/production">View forecasts</Link></div>
    <p className="record-meta">DC inventory − immediate demand · cases</p>
    {shortfalls.length ? <table className="schedule-shortfalls-table"><caption className="sr-only">Current warehouse inventory below immediate agency demand</caption><thead><tr><th scope="col">Product</th><th scope="col">Warehouse</th><th scope="col" className="numeric">DC inventory</th><th scope="col" className="numeric">Demand</th><th scope="col" className="numeric">Balance</th></tr></thead><tbody>{shortfalls.map(row => <tr key={`${row.product.productId}:${row.warehouse}`}>
      <th scope="row" className="schedule-shortfall-product"><Link href={detailHref(row.product.productId)}>{row.product.productName}</Link><small>{row.product.itemCode}</small></th>
      <td className="schedule-shortfall-warehouse" data-label="Warehouse">{row.warehouse}</td>
      <td className="numeric" data-label="DC inventory">{caseQuantity(row.inventoryCases)}</td>
      <td className="numeric" data-label="Demand">{cases(row.demandCases)}</td>
      <td className="numeric schedule-shortfall-balance" data-label="Balance"><strong>{caseBalance(row.balanceCases)}</strong><small>Shortfall</small></td>
    </tr>)}</tbody></table> : <p className="schedule-shortfalls-empty">{!data.rows.length ? 'No eligible forecasting products.' : unavailable ? 'No current shortfalls confirmed.' : 'No warehouse shortfalls.'}</p>}
    {unavailable ? <p className="record-meta schedule-shortfalls-coverage">{unavailable} warehouse {unavailable === 1 ? 'balance is' : 'balances are'} unavailable or stale; current shortfalls may be incomplete.</p> : null}
    {unassignedDemand > 0 ? <p className="record-meta">Known demand without a warehouse assignment: {cases(unassignedDemand)} cases.</p> : null}
  </section>;
}

export async function ScheduleProductionShortfalls(props: Props) {
  if (!canViewScheduleProductionShortfalls(props)) return null;
  try {
    const data = await getWarehouseBalanceSignals(props.organizationId);
    return <ProductionShortfallList data={data} returnTo={props.returnTo} />;
  } catch {
    return <section className="schedule-production-shortfalls" aria-labelledby="schedule-shortfalls-title"><div className="section-heading schedule-shortfalls-heading"><h2 id="schedule-shortfalls-title">Warehouse shortfalls</h2><Link href="/analytics/production">View forecasts</Link></div><p role="status" className="record-meta">Warehouse balances are unavailable. Open Production Forecasting to review sources.</p></section>;
  }
}
