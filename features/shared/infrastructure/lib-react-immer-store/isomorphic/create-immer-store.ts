import { produce, type Draft } from "immer";

type Listener = () => void;

export interface ExternalStore<T> {
  getSnapshot(): T;
  getState(): T;
  subscribe(listener: Listener): () => void;
  update(recipe: (draft: Draft<T>) => void): void;
  setState(nextState: T): void;
}

export function createImmerStore<T>(initialState: T): ExternalStore<T> {
  let state = initialState;
  const listeners = new Set<Listener>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getSnapshot(): T {
      return state;
    },

    getState(): T {
      return state;
    },

    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    update(recipe: (draft: Draft<T>) => void): void {
      const nextState = produce(state, recipe);

      if (Object.is(nextState, state)) {
        return;
      }

      state = nextState;
      notify();
    },

    setState(nextState: T): void {
      if (Object.is(nextState, state)) {
        return;
      }

      state = nextState;
      notify();
    },
  };
}
