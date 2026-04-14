import type DataLoader from "dataloader";

import type { DataLoaderRegistry } from "./create-data-loader-registry";

export interface IdleDataLoaderHandle<K, V, _C = K> {
  load: (key: K) => Promise<V>;
  /** Clears the DataLoader cache for this key (same as idle timeout). */
  clearCache: () => void;
}

/**
 * Advanced helper for long-lived runtimes: wraps {@link DataLoaderRegistry#getOrCreate}
 * with optional idle clearing. For request-scoped caching, prefer
 * {@link createDataLoaderRegistry} directly and let the request lifecycle drop the loaders.
 *
 * When `idleMs` is explicitly provided and greater than zero, after that many milliseconds
 * without a {@link IdleDataLoaderHandle.load} call, this wrapper runs `clearAll()` on the
 * loader instance. No default idle timeout is applied.
 */
export function createIdleDataLoader<K, V, C = K>(options: {
  registry: DataLoaderRegistry;
  loaderKey: string;
  factory: () => DataLoader<K, V, C>;
  idleMs?: number | undefined;
}): IdleDataLoaderHandle<K, V, C> {
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const getLoader = (): DataLoader<K, V, C> =>
    options.registry.getOrCreate(options.loaderKey, options.factory);

  const clearCache = (): void => {
    getLoader().clearAll();
  };

  const scheduleIdleClear = (): void => {
    const ms = options.idleMs;
    if (ms === undefined || ms <= 0) {
      return;
    }

    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
    }

    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      clearCache();
    }, ms);
  };

  return {
    load(key: K) {
      scheduleIdleClear();
      return getLoader().load(key);
    },
    clearCache,
  };
}
