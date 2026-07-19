import { z } from "zod";

/**
 * Load a .env file from the current working directory if present. Node's
 * built-in loader (>=20.12) means no dotenv dependency is required.
 */
function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file — rely on the real environment. This is fine.
  }
}

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  host: z.string().default("127.0.0.1"),
  databasePath: z.string().default("./data/holidaycheck-monitor.sqlite"),
  defaultCron: z.string().default("0 */6 * * *"),
  pushoverToken: z.string().optional(),
  pushoverUser: z.string().optional(),
  pushoverDevice: z.string().optional(),
  scrapeTimeoutMs: z.coerce.number().int().positive().default(45_000),
  // Parallel independent page loads per check; the cheapest across them wins.
  // More attempts = more reliable against HolidayCheck's partial-list cache.
  scrapeAttempts: z.coerce.number().int().min(1).max(10).default(4),
  headless: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() !== "false"),
});

export type Config = z.infer<typeof configSchema>;

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  loadDotEnv();
  cached = configSchema.parse({
    port: process.env.PORT,
    host: process.env.HOST,
    databasePath: process.env.DATABASE_PATH,
    defaultCron: process.env.DEFAULT_CRON,
    pushoverToken: process.env.PUSHOVER_TOKEN || undefined,
    pushoverUser: process.env.PUSHOVER_USER || undefined,
    pushoverDevice: process.env.PUSHOVER_DEVICE || undefined,
    scrapeTimeoutMs: process.env.SCRAPE_TIMEOUT_MS,
    scrapeAttempts: process.env.SCRAPE_ATTEMPTS,
    headless: process.env.HEADLESS,
  });
  return cached;
}
