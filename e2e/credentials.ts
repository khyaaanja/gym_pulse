/**
 * Sign-in for the browser tests, from the environment so no password lives in the repo. Against a database seeded
 * with `npm run db:seed`, the owner is owner@pulsefitness.demo and the password is the seed's SEED_DEMO_PASSWORD.
 */
export const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? "owner@pulsefitness.demo";

export const OWNER_PASSWORD = (() => {
  const p = process.env.E2E_OWNER_PASSWORD;
  if (!p) throw new Error("Set E2E_OWNER_PASSWORD (the demo owner's password) to run the browser tests");
  return p;
})();
