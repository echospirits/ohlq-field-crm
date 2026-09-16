ALTER TYPE "WholesaleOrderStatus" ADD VALUE 'COMPLETED';

ALTER TABLE "WholesaleOrder"
ADD COLUMN "paidAt" TIMESTAMP(3),
ADD COLUMN "paidByUserId" TEXT;

ALTER TABLE "WholesaleOrder"
ADD CONSTRAINT "WholesaleOrder_paidByUserId_fkey"
FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WholesaleOrder_checklist_date_idx"
ON "WholesaleOrder"("organizationId", "sentAt", "paidAt", "filedAt", "saleDate");
