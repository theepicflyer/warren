/**
 * Background jobs. One process serves the app, so a timer in it is enough: nothing double-runs
 * and there is no queue or worker to operate. Jobs are checked once a minute.
 */
import { type Db, getMeta, setMeta } from "./db.js";
import { localTime } from "./time.js";

export interface Job {
  name: string;
  /** Called once a minute. Must be quick, or do its slow work without holding a transaction. */
  run(now: Date): void | Promise<void>;
}

/**
 * A job that runs once per local day, at or after `hour:minute`. The day it last ran is stored,
 * so a restart doesn't repeat it and one missed while the app was down runs when it comes back.
 */
export function daily(options: {
  name: string;
  db: Db;
  timezone: string;
  hour: number;
  minute?: number;
  run(now: Date): void | Promise<void>;
}): Job {
  const key = `job:${options.name}:last_day`;
  return {
    name: options.name,
    async run(now) {
      const local = localTime(now, options.timezone);
      const due = local.hour * 60 + local.minute >= options.hour * 60 + (options.minute ?? 0);
      if (!due || getMeta(options.db, key) === local.date) return;
      await options.run(now);
      setMeta(options.db, key, local.date);
    },
  };
}

export async function runJobs(jobs: readonly Job[], now = new Date()): Promise<void> {
  for (const job of jobs) {
    try {
      await job.run(now);
    } catch (err) {
      console.error(`warren: job ${job.name} failed`, err);
    }
  }
}

/** Check the jobs just after each minute turns. Returns a function that stops it. */
export function startScheduler(jobs: readonly Job[]): () => void {
  let timer: NodeJS.Timeout;
  let stopped = false;
  const schedule = () => {
    timer = setTimeout(tick, 61_000 - (Date.now() % 60_000));
    timer.unref();
  };
  const tick = async () => {
    await runJobs(jobs);
    if (!stopped) schedule();
  };
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
