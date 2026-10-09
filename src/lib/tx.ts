/**
 * Options for transactions that move money. Prisma's default (5 s) turns a slow-database moment into a 500 while
 * the member is standing at the desk; the payment row is then left FAILED and the desk has to retry. Give these
 * transactions headroom instead. They hold row locks, so keep the work inside them short regardless.
 */
export const MONEY_TX = { timeout: 15_000, maxWait: 5_000 } as const;
