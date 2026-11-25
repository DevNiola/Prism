export {
  setCache,
  getCache,
  invalidateKey,
  invalidateByKey,
  invalidateByTxHash,
  invalidateEntry,
  clearByType,
  clearAll,
  getCacheStats,
  getHitMissRatio,
  resetCacheStats,
  getOrFetchWithLock,
} from "./manager";
