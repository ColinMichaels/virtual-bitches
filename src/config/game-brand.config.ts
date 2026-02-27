export type GameBrandConfig = {
  productName: string;
  logoUrl: string;
  ogTitle: string;
  ogDescription: string;
  ageGateRequired: boolean;
  contentRatingNotes: string[];
};

export const defaultGameBrandConfig: GameBrandConfig = Object.freeze({
  productName: "BISCUITS",
  logoUrl: "assets/logos/Biscuits_logo.png",
  ogTitle: "BISCUITS - Push Your Luck Dice Game",
  ogDescription: "Roll low, score lower, and challenge friends in BISCUITS.",
  ageGateRequired: false,
  contentRatingNotes: [],
});

export function isGameBrandConfig(value: unknown): value is GameBrandConfig {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<GameBrandConfig>;
  return (
    typeof candidate.productName === "string" &&
    candidate.productName.trim().length > 0 &&
    typeof candidate.logoUrl === "string" &&
    candidate.logoUrl.trim().length > 0 &&
    typeof candidate.ogTitle === "string" &&
    candidate.ogTitle.trim().length > 0 &&
    typeof candidate.ogDescription === "string" &&
    candidate.ogDescription.trim().length > 0 &&
    typeof candidate.ageGateRequired === "boolean" &&
    Array.isArray(candidate.contentRatingNotes) &&
    candidate.contentRatingNotes.every(
      (entry) => typeof entry === "string" && entry.trim().length > 0
    )
  );
}

export function assertGameBrandConfig(value: unknown): asserts value is GameBrandConfig {
  if (!isGameBrandConfig(value)) {
    throw new Error("Invalid GameBrandConfig");
  }
}
