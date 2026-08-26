import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { config } from "../config/index.js";

export function normalizePhone(input: string): string | null {
  const cleaned = input.trim().replace(/\s+/g, "");

  // If starts with 0, prepend default country code
  let withCode = cleaned;
  if (cleaned.startsWith("0")) {
    withCode = config.defaultCountryCode + cleaned.slice(1);
  }

  const parsed = parsePhoneNumberFromString(withCode);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.format("E.164");
}
