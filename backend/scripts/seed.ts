import { db } from "../src/db/index.js";
import { churches } from "../src/db/schema.js";

async function seed() {
  // These are real denominations with real, settled Amharic names. Every entry
  // below is the name the church uses for itself — none of it should be
  // re-translated from the English, which is how the previous list went wrong.
  const seedChurches = [
    // መካነ ኢየሱስ ("place of Jesus"), not መካነ ያረድ — ያረድ is St. Yared, the
    // sixth-century hymnographer, an unrelated name.
    { nameAm: "የኢትዮጵያ ወንጌላዊት ቤተ ክርስቲያን መካነ ኢየሱስ", nameEn: "Ethiopian Evangelical Church Mekane Yesus", denomination: "Protestant", city: "Addis Ababa" },
    // ቃለ ሕይወት = "word of life", which is what Kale Heywet transliterates. ቀላ
    // is not a word in this name.
    { nameAm: "የኢትዮጵያ ቃለ ሕይወት ቤተ ክርስቲያን", nameEn: "Ethiopian Kale Heywet Church", denomination: "Protestant", city: "Addis Ababa" },
    // One genitive የ, on ኢትዮጵያ. "የኢትዮጵያ የሙሉ ወንጌል" doubles it.
    { nameAm: "የኢትዮጵያ ሙሉ ወንጌል አማኞች ቤተ ክርስቲያን", nameEn: "Ethiopian Full Gospel Believers' Church", denomination: "Protestant", city: "Addis Ababa" },
    // መሠረተ with ሠ — the church's own spelling.
    { nameAm: "መሠረተ ክርስቶስ ቤተ ክርስቲያን", nameEn: "Meserete Kristos Church", denomination: "Protestant", city: "Addis Ababa" },
    // ኅብረት ("union, fellowship") is the word Ethiopian Protestant churches use
    // for "United". It was ተዋሕዶ, which is NOT the adjective "united" — it is
    // the doctrine of the unified nature of Christ and the defining term of the
    // Ethiopian Orthodox Tewahedo Church. On a row marked Protestant it named
    // the wrong denomination entirely. አማኑኤል is also the standard Ethiopian
    // rendering of Emmanuel, as in ቅዱስ አማኑኤል; ኢማኑኤል is a transliteration
    // nobody uses.
    { nameAm: "አማኑኤል ኅብረት ቤተ ክርስቲያን", nameEn: "Emmanuel United Church", denomination: "Protestant", city: "Addis Ababa" },
    { nameAm: "ሕይወት ብርሃን ቤተ ክርስቲያን", nameEn: "Hiwot Berhan Church", denomination: "Protestant", city: "Addis Ababa" },
    // Plural: አብያተ ክርስቲያናት. "ቤተ ክርስቲያናት" is a malformed plural, and the
    // English here is plural too.
    { nameAm: "የኢትዮጵያ ባፕቲስት አብያተ ክርስቲያናት", nameEn: "Ethiopian Baptist Churches", denomination: "Protestant", city: "Addis Ababa" },
  ];

  for (const church of seedChurches) {
    await db.insert(churches).values(church).onConflictDoNothing();
  }

  console.log("Seed complete");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
