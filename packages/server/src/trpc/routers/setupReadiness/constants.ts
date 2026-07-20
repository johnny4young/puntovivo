/**
 * a sync backlog above this many pending rows trips the
 * readiness warning. Small transient backlogs are normal in a local-first
 * app; only a sustained queue is worth a reminder.
 */
export const SYNC_BACKLOG_WARN_THRESHOLD = 25;
