-- Each SaaS plan can offer its own free period at signup (replaces the platform trial length when > 0).
ALTER TABLE "SaasPlan" ADD COLUMN "freeMonths" INTEGER NOT NULL DEFAULT 0;
