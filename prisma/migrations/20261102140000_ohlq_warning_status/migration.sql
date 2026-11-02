-- Add a distinct non-success, non-error outcome for an unchanged upstream source.
ALTER TYPE "OhlqReportRunStatus" ADD VALUE IF NOT EXISTS 'WARNING';
