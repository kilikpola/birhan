import { normalizeAmharic, isEthiopic } from "./search";

describe("Amharic Search Normalization", () => {
  test("folds H-family homophones (ሐ/ኀ/ኃ/ሃ/ኅ/ኻ) to ሀ", () => {
    expect(normalizeAmharic("ሐዋርያ")).toBe("ሀዋርያ");
    expect(normalizeAmharic("ኀይል")).toBe("ሀይል");
    expect(normalizeAmharic("ኃይል")).toBe("ሃይል");
    expect(normalizeAmharic("ሃይማኖት")).toBe("ሃይማኖት");
    expect(normalizeAmharic("ኅብረት")).toBe("ህብረት");
    expect(normalizeAmharic("ካሳ")).toBe("ካሳ"); // Keep normal k
  });

  test("folds S-family homophones (ሠ) to ሰ", () => {
    expect(normalizeAmharic("ሠራዊት")).toBe("ሰራዊት");
    expect(normalizeAmharic("ሰማይ")).toBe("ሰማይ");
  });

  test("folds A-family homophones (ዐ/ዓ) to አ", () => {
    expect(normalizeAmharic("ዐይነ ሥጋ")).toBe("አይነ ስጋ"); // Fold both A and S
    expect(normalizeAmharic("ዓለም")).toBe("ኣለም");
    expect(normalizeAmharic("አምላክ")).toBe("አምላክ");
  });

  test("folds TS-family homophones (ፀ) to ጸ", () => {
    expect(normalizeAmharic("ፀሐይ")).toBe("ጸሀይ"); // Fold TS and H
    expect(normalizeAmharic("ጸሎት")).toBe("ጸሎት");
  });

  test("detects Ethiopic unicode script correctly", () => {
    expect(isEthiopic("ሰማይ")).toBe(true);
    expect(isEthiopic("ሀይል")).toBe(true);
    expect(isEthiopic("Genesis 1")).toBe(false);
    expect(isEthiopic("KJV Bible")).toBe(false);
    expect(isEthiopic("")).toBe(false);
  });
});
