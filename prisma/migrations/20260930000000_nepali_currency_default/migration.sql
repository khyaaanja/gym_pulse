-- New gyms default to the Nepali rupee as written in Nepal. Existing gyms keep their chosen symbol.
ALTER TABLE "Gym" ALTER COLUMN "currencySymbol" SET DEFAULT 'Rs.';
