import { describe, it, expect, vi } from "vitest";
import { createImmerStore, type ExternalStore } from "./create-immer-store";

interface CounterState {
  value: number;
}

const initialState: CounterState = { value: 0 };

describe("createImmerStore", () => {
  it("returns initial snapshot and state", () => {
    const store = createImmerStore(initialState);

    expect(store.getSnapshot()).toEqual({ value: 0 });
    expect(store.getState()).toEqual({ value: 0 });
  });

  it("notifies subscribers on setState when state changes", () => {
    const store = createImmerStore(initialState);
    const listener = vi.fn();

    store.subscribe(listener);

    store.setState({ value: 1 });

    expect(store.getState()).toEqual({ value: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify subscribers on setState when state is unchanged (Object.is)", () => {
    const store =
      createImmerStore<ExternalStore<CounterState>["getState"] extends () => infer T ? T : never>(
        initialState
      );
    const listener = vi.fn();
    const sameReference = store.getState();

    store.subscribe(listener);

    // setState with exactly the same reference should not notify
    store.setState(sameReference);

    expect(listener).not.toHaveBeenCalled();
  });

  it("updates state immutably via update() and notifies subscribers", () => {
    const store = createImmerStore(initialState);
    const listener = vi.fn();

    store.subscribe(listener);

    store.update((draft) => {
      draft.value += 1;
    });

    expect(store.getState()).toEqual({ value: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify when update() recipe produces no change", () => {
    const store = createImmerStore(initialState);
    const listener = vi.fn();

    store.subscribe(listener);

    store.update(() => {
      // no change
    });

    expect(store.getState()).toEqual(initialState);
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribe stops receiving notifications", () => {
    const store = createImmerStore(initialState);
    const listener = vi.fn();

    const unsubscribe = store.subscribe(listener);

    unsubscribe();

    store.setState({ value: 2 });

    expect(listener).not.toHaveBeenCalled();
  });
});
