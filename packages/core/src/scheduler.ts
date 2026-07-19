import cron, { type ScheduledTask } from "node-cron";
import { loadConfig } from "./config.js";
import { checkWatch, getWatch, listWatches } from "./watchService.js";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Schedules a recurring price check per active watch using its cron expression.
 * Call reconcile() after any watch is created / updated / deleted.
 *
 * Scheduled (cron) checks are funneled through a single serial queue with a
 * fixed delay between them, so watches sharing the same cron don't all fire at
 * once (which would spawn N × SCRAPE_ATTEMPTS browser contexts simultaneously
 * and risk being throttled). Manual checks bypass the queue and run at once.
 */
export class Scheduler {
  private tasks = new Map<string, ScheduledTask>();
  private running = new Set<string>();
  private queue: string[] = [];
  private processing = false;
  private readonly delayMs: number;

  constructor() {
    this.delayMs = loadConfig().checkDelayMs;
  }

  start(): void {
    this.reconcile();
  }

  /** (Re)build scheduled tasks to match the current set of active watches. */
  reconcile(): void {
    const watches = listWatches();
    const activeIds = new Set(
      watches.filter((w) => w.active && cron.validate(w.cron)).map((w) => w.id),
    );

    // Remove tasks for watches that are gone or no longer active.
    for (const [id, task] of this.tasks) {
      if (!activeIds.has(id)) {
        task.stop();
        this.tasks.delete(id);
      }
    }

    // Add / replace tasks for active watches. Cron enqueues rather than running
    // directly, so ticks are processed one at a time with a delay between them.
    for (const w of watches) {
      if (!activeIds.has(w.id)) continue;
      const existing = this.tasks.get(w.id);
      if (existing) existing.stop();
      const id = w.id;
      const task = cron.schedule(w.cron, () => this.enqueue(id));
      this.tasks.set(w.id, task);
    }
  }

  /** Queue a watch for a scheduled check (deduped against queued/running). */
  private enqueue(watchId: string): void {
    if (this.running.has(watchId) || this.queue.includes(watchId)) return;
    this.queue.push(watchId);
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const id = this.queue.shift()!;
        // Guard against a hung check permanently wedging the queue.
        const cap = loadConfig().scrapeTimeoutMs * 4 + 30_000;
        await Promise.race([
          this.runCheck(id),
          sleep(cap).then(() =>
            console.error(`[scheduler] check for ${id} exceeded ${cap}ms; moving on`),
          ),
        ]);
        if (this.queue.length > 0 && this.delayMs > 0) {
          await sleep(this.delayMs);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /** Run a single check now, guarding against overlapping runs per watch. */
  async runCheck(watchId: string): Promise<void> {
    if (this.running.has(watchId)) return;
    const watch = getWatch(watchId);
    if (!watch) return;
    this.running.add(watchId);
    try {
      await checkWatch(watch);
    } catch (err) {
      console.error(`[scheduler] check failed for ${watchId}:`, err);
    } finally {
      this.running.delete(watchId);
    }
  }

  stop(): void {
    for (const task of this.tasks.values()) task.stop();
    this.tasks.clear();
    this.queue = [];
  }
}
