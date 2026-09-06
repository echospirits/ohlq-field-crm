import { OhlqReportRunStatus, Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);
const key = (organizationId: string, reportDate: string) => ({ organizationId_reportDate: { organizationId, reportDate: dateOnly(reportDate) } });

export async function startTenantInventoryRun(organizationId: string, reportDate: string, db: PrismaClient = prisma) {
  const startedAt = new Date();
  return db.ohlqTenantInventoryImportStatus.upsert({ where: key(organizationId, reportDate), create: { organizationId, reportDate: dateOnly(reportDate), startedAt, status: OhlqReportRunStatus.RUNNING }, update: { completedAt: null, diagnostics: Prisma.DbNull, errorMessage: null, filename: null, parsedRows: 0, replacedRows: 0, rowCount: 0, sizeBytes: 0, skippedRows: 0, startedAt, status: OhlqReportRunStatus.RUNNING } });
}

export async function completeTenantInventoryRun(organizationId: string, download: { filename: string; sizeBytes: number }, result: { deletedRows: number; diagnostics: unknown; importedRows: number; parsedRows: number; reportDate: string; skippedRows: number}, db: PrismaClient = prisma) {
  const completedAt = new Date();
  const data = { completedAt, diagnostics: result.diagnostics as Prisma.InputJsonValue, errorMessage: null, filename: download.filename, lastSuccessfulAt: completedAt, parsedRows: result.parsedRows, replacedRows: result.deletedRows, rowCount: result.importedRows, sizeBytes: download.sizeBytes, skippedRows: result.skippedRows, status: OhlqReportRunStatus.COMPLETED };
  return db.ohlqTenantInventoryImportStatus.upsert({ where: key(organizationId, result.reportDate), create: { ...data, organizationId, reportDate: dateOnly(result.reportDate), startedAt: completedAt }, update: data });
}

export async function errorTenantInventoryRun(organizationId: string, reportDate: string, error: unknown, db: PrismaClient = prisma) {
  const completedAt = new Date();
  const errorMessage = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  return db.ohlqTenantInventoryImportStatus.upsert({ where: key(organizationId, reportDate), create: { completedAt, errorMessage, organizationId, reportDate: dateOnly(reportDate), startedAt: completedAt, status: OhlqReportRunStatus.ERRORED }, update: { completedAt, errorMessage, status: OhlqReportRunStatus.ERRORED } });
}
