import { useSyncExternalStore } from "react";
import type { ExternalStore } from "../isomorphic/create-immer-store";

export function useImmerStore<T>(store: ExternalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
