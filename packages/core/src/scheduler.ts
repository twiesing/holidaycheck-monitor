import cron, { type ScheduledTask } from "node-cron";
import { checkWatch, getWatch, listWatches } from "./watchService.js";

/**
 * Schedules a recurring price check per active watch using its cron expression.
 * Call reconcile() after any watch is created / updated / deleted.
 */
export class Scheduler {
  private tasks = new Map<string, ScheduledTask>();
  private running = new Set<string>();

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

    // Add / replace tasks for active watches.
    for (const w of watches) {
      if (!activeIds.has(w.id)) continue;
      const existing = this.tasks.get(w.id);
      if (existing) existing.stop();
      const task = cron.schedule(w.cron, () => void this.runCheck(w.id));
      this.tasks.set(w.id, task);
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
  }
}
