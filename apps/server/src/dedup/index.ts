export {
  fingerprint,
  tryAcquire,
  publishResult,
  waitForResult,
  isBlacklisted,
  recordFailure,
  resetFailures,
  BLACKLIST_FAILURE_THRESHOLD,
  BLACKLIST_COOLDOWN_MS,
} from "./dedup";
export type { DedupAcquireResult } from "./dedup";
