-- AlterTable
ALTER TABLE "ProcedureCatalog" ADD COLUMN "copayBasis" TEXT;
ALTER TABLE "ProcedureCatalog" ADD COLUMN "copayRate" REAL;
ALTER TABLE "ProcedureCatalog" ADD COLUMN "estimatedCopayAvg" DECIMAL;
