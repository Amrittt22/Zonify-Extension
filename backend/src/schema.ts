import { z } from "zod";

/**
 * The strict request schema IS the privacy guarantee: the endpoint can only
 * ever receive the aggregate numbers below. URLs, page titles, timestamps,
 * browsing history or any other field is rejected with 400 INVALID_REQUEST,
 * so they can never reach logs or the model.
 */

const MINUTE_LIMIT = 10080; // minutes in a week

const minutes = z.number().int().min(0).max(MINUTE_LIMIT);
const count0to500 = z.number().int().min(0).max(500);

/** Lowercase ASCII hostname, e.g. "youtube.com" or "sub.example.co.uk". */
export const LOWERCASE_HOSTNAME =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

const summarySchema = z
  .object({
    /** Human label for the week, e.g. "Oct 13 – Oct 19". */
    week: z.string().min(1).max(40),
    totalFocusMinutes: minutes,
    sessionsCompleted: count0to500,
    sessionsStartedButEndedEarly: count0to500,
    streakDays: z.number().int().min(0).max(3650),
    minutesByDay: z
      .object({
        Mon: minutes,
        Tue: minutes,
        Wed: minutes,
        Thu: minutes,
        Fri: minutes,
        Sat: minutes,
        Sun: minutes,
      })
      .strict(),
    minutesByHourBucket: z
      .object({
        morning: minutes,
        afternoon: minutes,
        evening: minutes,
      })
      .strict(),
    topBlockedDomains: z
      .array(
        z
          .object({
            domain: z.string().regex(LOWERCASE_HOSTNAME, {
              message: "must be a lowercase hostname like youtube.com",
            }),
            attempts: z.number().int().min(0).max(100000),
          })
          .strict(),
      )
      .max(3),
    previousWeekFocusMinutes: minutes.nullable(),
  })
  .strict();

export const insightsRequestSchema = z
  .object({
    installId: z.string().uuid("installId must be a UUID"),
    summary: summarySchema,
  })
  .strict();

export type InsightsRequest = z.infer<typeof insightsRequestSchema>;
export type WeeklySummary = InsightsRequest["summary"];

/** Validation issue reported to the client as 400 INVALID_REQUEST. */
export interface RequestIssue {
  path: string;
  message: string;
}

export function toIssues(error: z.ZodError): RequestIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/** Shape the model must return; also enforced by parseInsight() in llm.ts. */
export interface Insight {
  headline: string;
  highlights: string[];
  suggestion: string;
}

/** Output limits applied when parsing model output. */
export const INSIGHT_LIMITS = {
  headline: 120,
  highlight: 200,
  suggestion: 200,
  highlightsMin: 2,
  highlightsMax: 3,
} as const;
