import { prisma } from '../lib/prisma';

type StorageRow = {
  estimated_rows: bigint;
  heap_bytes: bigint;
  index_bytes: bigint;
  table_name: string;
  total_bytes: bigint;
};

const bytesToMb = (value: bigint) => (Number(value) / 1024 / 1024).toFixed(1);

async function main() {
  const rows = await prisma.$queryRawUnsafe<StorageRow[]>(`
    select
      c.relname as table_name,
      c.reltuples::bigint as estimated_rows,
      pg_relation_size(c.oid) as heap_bytes,
      pg_indexes_size(c.oid) as index_bytes,
      pg_total_relation_size(c.oid) as total_bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('OhlqAnnualSalesRow', 'OhlqAnnualSalesByWholesaleRow')
    order by pg_total_relation_size(c.oid) desc
  `);

  console.table(
    rows.map((row) => ({
      table: row.table_name,
      estimatedRows: Number(row.estimated_rows),
      heapMb: bytesToMb(row.heap_bytes),
      indexMb: bytesToMb(row.index_bytes),
      totalMb: bytesToMb(row.total_bytes),
    })),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
