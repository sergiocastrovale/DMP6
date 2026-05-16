-- Add PENDING_REVERT to IssueStatus enum
ALTER TYPE "IssueStatus" ADD VALUE 'PENDING_REVERT';

-- Create FixHistory table
CREATE TABLE "FixHistory" (
    "id" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "previousState" JSONB NOT NULL,
    "appliedState" JSONB NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FixHistory_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX "FixHistory_issueId_idx" ON "FixHistory"("issueId");
CREATE INDEX "FixHistory_issueType_revertedAt_idx" ON "FixHistory"("issueType", "revertedAt");
CREATE INDEX "FixHistory_filePath_idx" ON "FixHistory"("filePath");
