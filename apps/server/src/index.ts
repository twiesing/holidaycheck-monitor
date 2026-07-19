import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import {
  Scheduler,
  closeBrowser,
  closeDb,
  createWatch,
  createWatchSchema,
  deleteWatch,
  getDb,
  getWatch,
  listHistory,
  listWatches,
  loadConfig,
  updateWatch,
  updateWatchSchema,
  type PricePoint,
  type Watch,
} from "@holidaycheck-monitor/core";
import Fastify from "fastify";
import { ZodError } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();

getDb(); // initialize schema up front
const scheduler = new Scheduler();
scheduler.start();

const app = Fastify({ logger: true });

interface WatchStats {
  min: number;
  max: number;
  avg: number;
  count: number;
  firstAt: string;
  /** Current price equals the all-time low (and we have more than one point). */
  isAllTimeLow: boolean;
}

interface WatchWithLatest extends Watch {
  latest: PricePoint | null;
  previousPrice: number | null;
  stats: WatchStats | null;
}

function withLatest(watch: Watch): WatchWithLatest {
  const history = listHistory(watch.id);
  const priced = history.filter((p) => p.price !== null);
  const latest = history.at(-1) ?? null;
  const previousPrice =
    priced.length >= 2 ? (priced.at(-2)?.price ?? null) : null;

  let stats: WatchStats | null = null;
  if (priced.length > 0) {
    const prices = priced.map((p) => p.price as number);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const current = latest?.price ?? null;
    stats = {
      min,
      max,
      avg,
      count: priced.length,
      firstAt: priced[0]!.checkedAt,
      isAllTimeLow: current !== null && current <= min && priced.length > 1,
    };
  }

  return { ...watch, latest, previousPrice, stats };
}

function handleError(err: unknown, reply: import("fastify").FastifyReply): void {
  if (err instanceof ZodError) {
    void reply.status(400).send({ error: "validation", issues: err.issues });
    return;
  }
  app.log.error(err);
  void reply.status(500).send({ error: "internal" });
}

app.get("/api/watches", async () => listWatches().map(withLatest));

app.post("/api/watches", async (req, reply) => {
  try {
    const input = createWatchSchema.parse(req.body);
    const watch = createWatch(input);
    scheduler.reconcile();
    // Kick off an initial check in the background so the UI fills in soon.
    void scheduler.runCheck(watch.id);
    return reply.status(201).send(watch);
  } catch (err) {
    return handleError(err, reply);
  }
});

app.get("/api/watches/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const watch = getWatch(id);
  if (!watch) return reply.status(404).send({ error: "not_found" });
  return withLatest(watch);
});

app.patch("/api/watches/:id", async (req, reply) => {
  try {
    const { id } = req.params as { id: string };
    const input = updateWatchSchema.parse(req.body);
    const watch = updateWatch(id, input);
    if (!watch) return reply.status(404).send({ error: "not_found" });
    scheduler.reconcile();
    return watch;
  } catch (err) {
    return handleError(err, reply);
  }
});

app.delete("/api/watches/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const ok = deleteWatch(id);
  if (!ok) return reply.status(404).send({ error: "not_found" });
  scheduler.reconcile();
  return reply.status(204).send();
});

app.get("/api/watches/:id/history", async (req, reply) => {
  const { id } = req.params as { id: string };
  if (!getWatch(id)) return reply.status(404).send({ error: "not_found" });
  return listHistory(id, 10_000);
});

app.post("/api/watches/:id/check", async (req, reply) => {
  const { id } = req.params as { id: string };
  const watch = getWatch(id);
  if (!watch) return reply.status(404).send({ error: "not_found" });
  await scheduler.runCheck(id);
  return withLatest(getWatch(id) as Watch);
});

// Serve the built frontend when present (production). In dev, use `vite`.
const webDist = resolve(__dirname, "../../web/dist");
if (existsSync(join(webDist, "index.html"))) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.status(404).send({ error: "not_found" });
    }
    return reply.sendFile("index.html");
  });
}

const server = await app.listen({ port: config.port, host: config.host });
app.log.info(`holidaycheck-monitor listening on ${server}`);

async function shutdown(): Promise<void> {
  scheduler.stop();
  await app.close();
  await closeBrowser();
  closeDb();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
