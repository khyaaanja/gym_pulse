import { prisma } from "@/db/client";
import type { ContentSection } from "@/generated/prisma/enums";

/** Latest PUBLISHED version of a content block (CMS-managed copy). */
export async function publishedContent<T = Record<string, unknown>>(section: ContentSection, key: string, locale = "en"): Promise<T | null> {
  const row = await prisma.contentEntry.findFirst({ where: { section, key, locale, status: "PUBLISHED" }, orderBy: { version: "desc" } });
  return (row?.data as T) ?? null;
}

export async function platformSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await prisma.platformSetting.findUnique({ where: { key } });
  return (s?.value as T) ?? fallback;
}

/** Latest PUBLISHED version with its publish date, for pages that show "last updated". */
export async function publishedEntry<T = Record<string, unknown>>(section: ContentSection, key: string, locale = "en") {
  const row = await prisma.contentEntry.findFirst({ where: { section, key, locale, status: "PUBLISHED" }, orderBy: { version: "desc" } });
  return row ? { data: row.data as T, title: row.title, version: row.version, updatedAt: row.publishedAt ?? row.createdAt } : null;
}
