export interface ExperienceRangeMonths {
  minimum: number | null;
  maximum: number | null;
}

const YEAR = String.raw`(?:years?|yrs?)(?:['’])?`;
const EXPERIENCE = String.raw`(?:of\s+)?(?:(?:relevant|professional|commercial|industry|total|overall|hands-on)\s+)*(?:work\s+)?(?:experience|exp)`;
const RANGE_SEPARATOR = String.raw`(?:-|–|—|to)`;

/**
 * Extracts explicit experience requirements without treating calendar years,
 * education durations, or unrelated numbers as candidate requirements.
 */
export function inferExperienceMonths(text: string): ExperienceRangeMonths {
  // ATS titles frequently compress the requirement to forms such as
  // "(4 - 6 years, Java)" without the word "experience". Prefer an explicit
  // title range over incidental experience numbers later in the description.
  // Callers provide the job title as the first line.
  const title = text.split(/\r?\n/, 1)[0] ?? "";
  const titleRange = new RegExp(String.raw`\b(\d{1,2})\s*${RANGE_SEPARATOR}\s*(\d{1,2})\s*${YEAR}\b`, "i").exec(title);
  if (titleRange?.[1] && titleRange[2]) {
    const minimum = Number(titleRange[1]);
    const maximum = Number(titleRange[2]);
    if (minimum <= maximum && maximum <= 40) return { minimum: minimum * 12, maximum: maximum * 12 };
  }
  const titleMinimum = new RegExp(String.raw`\b(\d{1,2})\+\s*${YEAR}\b`, "i").exec(title);
  if (titleMinimum?.[1] && Number(titleMinimum[1]) <= 40) {
    return { minimum: Number(titleMinimum[1]) * 12, maximum: null };
  }

  const rangeExpressions = [
    new RegExp(String.raw`\b(\d{1,2})\s*${RANGE_SEPARATOR}\s*(\d{1,2})\s*${YEAR}\s*${EXPERIENCE}\b`, "i"),
    new RegExp(String.raw`\b(\d{1,2})\s*${YEAR}\s*${RANGE_SEPARATOR}\s*(\d{1,2})\s*${YEAR}(?:\s*${EXPERIENCE})?\b`, "i"),
    new RegExp(String.raw`\b${EXPERIENCE}\s*(?:of|:)?\s*(\d{1,2})\s*${RANGE_SEPARATOR}\s*(\d{1,2})\s*${YEAR}\b`, "i"),
    new RegExp(String.raw`\bbetween\s+(\d{1,2})\s*(?:and|to)\s*(\d{1,2})\s*${YEAR}\s*${EXPERIENCE}\b`, "i")
  ];
  for (const expression of rangeExpressions) {
    const match = expression.exec(text);
    if (!match?.[1] || !match[2]) continue;
    const minimum = Number(match[1]);
    const maximum = Number(match[2]);
    if (minimum <= maximum && maximum <= 40) return { minimum: minimum * 12, maximum: maximum * 12 };
  }

  const minimumExpressions = [
    new RegExp(String.raw`\b(?:at\s+least|minimum(?:\s+of)?)\s+(\d{1,2})\+?\s*${YEAR}\s*${EXPERIENCE}\b`, "i"),
    new RegExp(String.raw`\b(\d{1,2})\+\s*${YEAR}\s*${EXPERIENCE}\b`, "i"),
    new RegExp(String.raw`\b${EXPERIENCE}\s*(?:of|:)?\s*(?:at\s+least\s+|minimum(?:\s+of)?\s+)?(\d{1,2})\+?\s*${YEAR}\b`, "i")
  ];
  for (const expression of minimumExpressions) {
    const match = expression.exec(text);
    if (match?.[1] && Number(match[1]) <= 40) {
      return { minimum: Number(match[1]) * 12, maximum: null };
    }
  }

  return { minimum: null, maximum: null };
}
