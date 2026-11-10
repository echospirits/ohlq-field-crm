import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../prisma';
import { getCurrentDemandSignals, type CurrentDemandSignal } from './demandIngestion';
import { emptyDcInventorySignal, getDcInventorySignals, type CurrentDcInventorySignal } from './dcInventoryIngestion';
import { dcWarehouses, type DcWarehouse } from './dcInventory';

export type WarehouseBalance = { demandCases: number | null; inventoryCases: number | null; balanceCases: number | null; status: 'AVAILABLE' | 'STALE' | 'UNAVAILABLE' };
export type WarehouseBalanceSignal = {
  productId: string; itemCode: string; productName: string;
  warehouses: Record<DcWarehouse, WarehouseBalance>;
  demand: CurrentDemandSignal; inventory: CurrentDcInventorySignal;
};

/** Both pages share this arithmetic. Retained raw amounts stay visible, while
 * the actionable balance requires complete current observations on both sides. */
export function warehouseBalanceFor(demand: CurrentDemandSignal, inventory: CurrentDcInventorySignal, today: string): WarehouseBalanceSignal {
  const demandCurrent = demand.status === 'AVAILABLE' && demand.demandCases !== null && !demand.stale && demand.businessDate === today && demand.sourceFreshness === 'CURRENT';
  const warehouses = Object.fromEntries(dcWarehouses.map(location => {
    const demandCases = demand.byWarehouse[location], inventoryCases = inventory.byWarehouse[location], source = inventory.warehouses[location];
    const current = demandCurrent && source.status === 'AVAILABLE' && !source.stale && source.businessDate === today && source.sourceBusinessDate === today && demandCases !== null && inventoryCases !== null;
    const stale = demand.stale || (demand.businessDate !== null && demand.businessDate !== today) || demand.sourceFreshness === 'STALE' || source.stale;
    return [location, { demandCases, inventoryCases, balanceCases: current ? Math.round((inventoryCases - demandCases) * 10000) / 10000 : null, status: current ? 'AVAILABLE' : stale ? 'STALE' : 'UNAVAILABLE' }];
  })) as Record<DcWarehouse, WarehouseBalance>;
  return { productId: demand.productId, itemCode: demand.itemCode, productName: demand.productName, warehouses, demand, inventory };
}

export async function getWarehouseBalanceSignals(organizationId: string, db: PrismaClient = prisma, now = new Date()) {
  const [demand, inventory] = await Promise.all([getCurrentDemandSignals(organizationId, db, now), getDcInventorySignals(organizationId, db, now)]);
  const inventories = new Map(inventory.rows.map(row => [row.productId, row]));
  // Both readers use the same current forecasting eligibility. Missing inventory
  // is included by its reader as an explicit unavailable signal, never zero.
  return { today: demand.today, rows: demand.rows.map(row => warehouseBalanceFor(row, inventories.get(row.productId) ?? emptyDcInventorySignal({ id: row.productId, code: row.itemCode, name: row.productName }), demand.today)) };
}
