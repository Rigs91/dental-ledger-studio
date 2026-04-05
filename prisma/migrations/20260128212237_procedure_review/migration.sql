-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProcedureRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visitId" TEXT NOT NULL,
    "freeText" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "rationale" TEXT NOT NULL,
    "candidateCodes" JSONB NOT NULL,
    "selectedCode" TEXT,
    "selectedLabel" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcedureRecord_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ProcedureRecord" ("candidateCodes", "confidence", "createdAt", "freeText", "id", "normalizedText", "rationale", "selectedCode", "selectedLabel", "visitId") SELECT "candidateCodes", "confidence", "createdAt", "freeText", "id", "normalizedText", "rationale", "selectedCode", "selectedLabel", "visitId" FROM "ProcedureRecord";
DROP TABLE "ProcedureRecord";
ALTER TABLE "new_ProcedureRecord" RENAME TO "ProcedureRecord";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
