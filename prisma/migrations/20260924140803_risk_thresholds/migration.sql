-- AlterTable
ALTER TABLE "PredictionConfig" ALTER COLUMN "moderateThreshold" SET DEFAULT 30,
ALTER COLUMN "highThreshold" SET DEFAULT 50,
ALTER COLUMN "criticalThreshold" SET DEFAULT 75;
