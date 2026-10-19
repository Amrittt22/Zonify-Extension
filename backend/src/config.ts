import { z } from "zod";

/**
 * Environment configuration, validated with zod.
 *
 * Fail-fast rule: the server refuses to start when ANTHROPIC_API_KEY is
 * missing unless MOCK_LLM=true (local development / tests).
 */

const emptyToUndefined = (value: unknown): unknown => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
};

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === "boolean"
      ? value
      : ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()),
  );

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  MODEL: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default("claude-haiku-5-5"),
  ),
  ALLOWED_ORIGINS: z.preprocess(emptyToUndefined, z.string().default("")),
  TRUST_PROXY: boolish.default(false),
  IP_LIMIT_PER_HOUR: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(1_000_000).default(30),
  ),
  DAILY_LIMIT_PER_INSTALL: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(1_000_000).default(5),
  ),
  GLOBAL_DAILY_LIMIT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(10_000_000).default(500),
  ),
  MOCK_LLM: boolish.default(false),
});

export interface AppConfig {
  port: number;
  anthropicApiKey: string | undefined;
  model: string;
  allowedOrigins: string[];
  trustProxy: boolean;
  ipLimitPerHour: number;
  dailyLimitPerInstall: number;
  globalDailyLimit: number;
  mockLlm: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const raw = parsed.data;
  if (!raw.ANTHROPIC_API_KEY && !raw.MOCK_LLM) {
    throw new Error(
      "ANTHROPIC_API_KEY is required to start the server. " +
        "Set it in .env (see .env.example) or set MOCK_LLM=true for local development.",
    );
  }

  return {
    port: raw.PORT,
    anthropicApiKey: raw.ANTHROPIC_API_KEY,
    model: raw.MODEL,
    allowedOrigins: raw.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    trustProxy: raw.TRUST_PROXY,
    ipLimitPerHour: raw.IP_LIMIT_PER_HOUR,
    dailyLimitPerInstall: raw.DAILY_LIMIT_PER_INSTALL,
    globalDailyLimit: raw.GLOBAL_DAILY_LIMIT,
    mockLlm: raw.MOCK_LLM,
  };
}

let cached: AppConfig | undefined;

/** Lazy singleton so importing this module never throws on its own. */
export function getConfig(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Tests use this to inject fresh environments between cases. */
export function resetConfigCache(): void {
  cached = undefined;
}
