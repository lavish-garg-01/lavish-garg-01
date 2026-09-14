import assert from "node:assert/strict";
import test from "node:test";
import { inferExperienceMonths } from "./experience.js";

test("extracts common explicit experience requirements", () => {
  const cases: Array<[string, { minimum: number | null; maximum: number | null }]> = [
    ["You have 4-6 years of relevant work experience building services.", { minimum: 48, maximum: 72 }],
    ["Requires 3 – 5 yrs professional experience.", { minimum: 36, maximum: 60 }],
    ["Requires 4 yrs - 6 yrs professional experience.", { minimum: 48, maximum: 72 }],
    ["Backend Engineer with 6-10 years' exp in Java.", { minimum: 72, maximum: 120 }],
    ["Senior Network Engineer (4 - 6 years managing networks)\nOwn global connectivity.", { minimum: 48, maximum: 72 }],
    ["Senior Network Engineer (4 - 6 years managing networks)\nAt least 5 years of professional experience.", { minimum: 48, maximum: 72 }],
    ["Data Reliability Engineering Manager (8+ years)\nLead the platform group.", { minimum: 96, maximum: null }],
    ["Relevant work experience: 2 to 4 years.", { minimum: 24, maximum: 48 }],
    ["At least 5 years of hands-on work experience is required.", { minimum: 60, maximum: null }],
    ["7+ years industry experience.", { minimum: 84, maximum: null }],
    ["Overall experience of minimum 6 years.", { minimum: 72, maximum: null }]
  ];
  for (const [description, expected] of cases) assert.deepEqual(inferExperienceMonths(description), expected);
});

test("does not infer experience from unrelated years and dates", () => {
  for (const description of [
    "Bachelor degree completed between 2019-2023.",
    "Reliable Systems\nOur company has operated for 8+ years.",
    "Founded in 2015 with a team of 6 engineers.",
    "Use Node.js, PostgreSQL, and AWS."
  ]) assert.deepEqual(inferExperienceMonths(description), { minimum: null, maximum: null });
});
