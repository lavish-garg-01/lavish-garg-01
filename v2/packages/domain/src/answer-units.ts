/** Pure, shared unit rules. No candidate state, provider calls or floating-point money. */
export class AnswerUnitError extends Error {
  constructor(readonly reasonCode: string) { super(reasonCode); }
}

export function exactScale(input: string, numerator = 1n, denominator = 1n): string {
  if (input.length > 90 || !/^\d+(?:\.\d{1,18})?$/.test(input) || numerator < 0n || denominator <= 0n) throw new AnswerUnitError("NUMBER_INVALID");
  const [whole, fraction = ""] = input.split(".");
  const dividend = BigInt(whole! + fraction) * numerator;
  const divisor = denominator * 10n ** BigInt(fraction.length);
  let remainder = dividend % divisor;
  let decimals = "";
  while (remainder && decimals.length < 18) {
    remainder *= 10n; decimals += String(remainder / divisor); remainder %= divisor;
  }
  if (remainder) throw new AnswerUnitError("NON_TERMINATING_CONVERSION");
  return String(dividend / divisor) + (decimals ? `.${decimals.replace(/0+$/, "")}` : "");
}

export function cleanDecimal(input: string): string {
  const value = input.trim();
  // Validate grouping before stripping it: 1,5 must not become 15.
  if (value.includes(",") && !/^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?$/.test(value)) throw new AnswerUnitError("NUMBER_GROUPING_INVALID");
  return exactScale(value.replace(/,/g, ""));
}

const currencyCodes = new Set(Intl.supportedValuesOf("currency"));
export type MoneyPeriod = "HOUR" | "DAY" | "WEEK" | "MONTH" | "YEAR" | "ONE_TIME";
export function moneyUnits(context: string): { currency: string | null; period: MoneyPeriod | null; scale: bigint } {
  const upper = context.toUpperCase();
  if (/\b(?:THOUSANDS?|MILLIONS?|BILLIONS?|QUARTERLY|FORTNIGHTLY)\b/.test(upper)) throw new AnswerUnitError("MONEY_UNIT_UNSUPPORTED");
  const currencies = new Set((upper.match(/\b[A-Z]{3}\b/g) ?? []).filter(code => currencyCodes.has(code)));
  if (/₹|\bRUPEES?\b|\bRS\.?\s/.test(upper)) currencies.add("INR");
  if (upper.includes("€")) currencies.add("EUR");
  if (upper.includes("£")) currencies.add("GBP");
  if (upper.includes("$") && !["USD", "CAD", "AUD", "SGD"].some(code => currencies.has(code))) throw new AnswerUnitError("CURRENCY_AMBIGUOUS");
  if (currencies.size > 1) throw new AnswerUnitError("CURRENCY_CONFLICT");
  const lakh = /\b(?:LPA|LAKHS?|LACS?)\b/.test(upper);
  const crore = /\bCRORES?\b/.test(upper);
  if (lakh && crore) throw new AnswerUnitError("MONEY_SCALE_CONFLICT");
  const monthly = /\b(?:MONTHS?|MONTHLY|PCM)\b|P\.M\./.test(upper);
  const yearly = /\b(?:YEARS?|YEARLY|ANNUAL(?:LY)?|ANNUM|LPA)\b|P\.A\./.test(upper);
  const periods: MoneyPeriod[] = [];
  if (monthly) periods.push("MONTH"); if (yearly) periods.push("YEAR");
  if (/\bHOURLY\b|\bPER\s+HOUR\b/.test(upper)) periods.push("HOUR");
  if (/\bDAILY\b|\bPER\s+DAY\b/.test(upper)) periods.push("DAY");
  if (/\bWEEKLY\b|\bPER\s+WEEK\b/.test(upper)) periods.push("WEEK");
  if (/\bONE[- ]TIME\b/.test(upper)) periods.push("ONE_TIME");
  if (periods.length > 1) throw new AnswerUnitError("MONEY_PERIOD_CONFLICT");
  return { currency: [...currencies][0] ?? null, period: periods[0] ?? null, scale: crore ? 10_000_000n : lakh ? 100_000n : 1n };
}

export function convertMoney(amount: string, source: string, target: MoneyPeriod, scale: bigint): string {
  if (source === target) return exactScale(amount, 1n, scale);
  if (source !== "YEAR" && source !== "MONTH") throw new AnswerUnitError("MONEY_PERIOD_UNSUPPORTED");
  if (target !== "YEAR" && target !== "MONTH") throw new AnswerUnitError("MONEY_PERIOD_UNSUPPORTED");
  const numerator = source === "MONTH" && target === "YEAR" ? 12n : 1n;
  const denominator = (source === "YEAR" && target === "MONTH" ? 12n : 1n) * scale;
  return exactScale(amount, numerator, denominator);
}

export function learnMoney(raw: string, label: string, countryCode: string | null) {
  const units = moneyUnits(`${label} ${raw}`);
  const currency = units.currency ?? (countryCode === "IN" ? "INR" : countryCode === "US" ? "USD" : null);
  if (!currency) throw new AnswerUnitError("CURRENCY_AMBIGUOUS");
  if (units.scale !== 1n && currency !== "INR") throw new AnswerUnitError("MONEY_SCALE_CURRENCY_CONFLICT");
  const period = units.period ?? (/\bctc\b/i.test(label) ? "YEAR" : null);
  if (!period) throw new AnswerUnitError("MONEY_PERIOD_AMBIGUOUS");
  const numeric = raw.replace(/\b[A-Za-z]{3}\b/g, token => currencyCodes.has(token.toUpperCase()) ? "" : token)
    .replace(/\b(?:rupees?|rs\.?|lpa|lakhs?|lacs?|crores?|one[- ]time|per|a|an|year|annum|annual(?:ly)?|monthly|month|hour|day|week)\b/gi, "")
    .replace(/[₹$£€]/g, "").trim();
  return { amountExact: exactScale(cleanDecimal(numeric), units.scale), currency, period };
}

export function learnDurationMonths(raw: string, label: string): number {
  const value = raw.trim().toLowerCase();
  if (/\b(?:completed|whole|full)\b/i.test(label) && /^\d+(?:\.\d+)?$/.test(value)) throw new AnswerUnitError("DURATION_BUCKET_NOT_EXACT");
  // Ranges express a bucket, never an exact tenure fact.
  if (/\+|\bto\b|\d\s*[-–]\s*\d/.test(value)) throw new AnswerUnitError("DURATION_RANGE_NOT_EXACT");
  let months: string;
  const compound = value.match(/^(\d+)\s*(?:years?|yrs?)\s*(\d+)\s*(?:months?|mos?)$/);
  const unit = value.match(/^(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mos?)$/);
  if (compound) {
    if (Number(compound[2]) >= 12) throw new AnswerUnitError("DURATION_INVALID");
    months = String(BigInt(compound[1]!) * 12n + BigInt(compound[2]!));
  } else if (unit) months = exactScale(unit[1]!, /^y/.test(unit[2]!) ? 12n : 1n);
  else {
    const years = /\b(?:years?|yrs?)\b/i.test(label), month = /\bmonths?\b/i.test(label);
    if (years === month) throw new AnswerUnitError("DURATION_UNIT_AMBIGUOUS");
    months = exactScale(cleanDecimal(value), years ? 12n : 1n);
  }
  const result = Number(months);
  if (!Number.isSafeInteger(result) || result < 0 || result > 1_200) throw new AnswerUnitError("DURATION_PRECISION_INVALID");
  return result;
}

export function learnNoticeDays(raw: string): number {
  const value = raw.trim().toLowerCase();
  const match = value.match(/^(\d+)\s*(?:(days?|weeks?)(?:['’]?\s*notice|\s+after\s+offer\s+acceptance)?)?$/);
  if (!match) throw new AnswerUnitError("NOTICE_DURATION_AMBIGUOUS");
  const days = Number(match[1]) * (match[2]?.startsWith("week") ? 7 : 1);
  if (!Number.isSafeInteger(days) || days < 0 || days > 3650) throw new AnswerUnitError("NOTICE_DURATION_INVALID");
  return days;
}
