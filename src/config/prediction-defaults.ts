/** Client-safe prediction defaults (no server imports). */
export const DEFAULT_WEIGHTS = {
  inactivity: 30,
  decline: 20,
  expiry: 20,
  gap: 10,
  frequency: 10,
  renewalHistory: 10,
};
export type RiskWeights = typeof DEFAULT_WEIGHTS;

export const DEFAULT_LABELS = {
  LOW: "Low Risk",
  MODERATE: "Moderate Risk",
  HIGH: "High Risk",
  CRITICAL: "Critical Attention",
};
