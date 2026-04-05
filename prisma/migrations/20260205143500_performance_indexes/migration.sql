-- Performance indexes for high-traffic filtering and timeline reads
CREATE INDEX IF NOT EXISTS "InsurancePolicy_patientId_effectiveStart_effectiveEnd_priority_idx"
ON "InsurancePolicy"("patientId", "effectiveStart", "effectiveEnd", "priority");

CREATE INDEX IF NOT EXISTS "InsuranceOverride_patientId_effectiveStart_effectiveEnd_idx"
ON "InsuranceOverride"("patientId", "effectiveStart", "effectiveEnd");

CREATE INDEX IF NOT EXISTS "Visit_patientId_dateOfService_idx"
ON "Visit"("patientId", "dateOfService");

CREATE INDEX IF NOT EXISTS "Appointment_status_scheduledAt_idx"
ON "Appointment"("status", "scheduledAt");

CREATE INDEX IF NOT EXISTS "Claim_status_createdAt_idx"
ON "Claim"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "Claim_patientId_visitId_idx"
ON "Claim"("patientId", "visitId");

CREATE INDEX IF NOT EXISTS "ClaimSubmission_claimId_createdAt_idx"
ON "ClaimSubmission"("claimId", "createdAt");

CREATE INDEX IF NOT EXISTS "ClaimDecision_claimId_occurredAt_idx"
ON "ClaimDecision"("claimId", "occurredAt");

CREATE INDEX IF NOT EXISTS "LedgerEvent_claimId_occurredAt_idx"
ON "LedgerEvent"("claimId", "occurredAt");

CREATE INDEX IF NOT EXISTS "LedgerEvent_patientId_occurredAt_idx"
ON "LedgerEvent"("patientId", "occurredAt");

CREATE INDEX IF NOT EXISTS "Flag_status_lastDetectedAt_idx"
ON "Flag"("status", "lastDetectedAt");
