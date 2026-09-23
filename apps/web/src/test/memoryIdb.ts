// An in-memory idb-keyval, for the tests that exercise the offline mirror.
//
// jsdom has no IndexedDB. The mirror is failure-tolerant by design, so under
// jsdom it silently stores nothing — which means a test for "serves from the
// mirror when the network fails" would pass for the wrong reason: the fallback
// path would look correct while never actually being reached.
//
// So the mirror's own code stays under test and only the storage underneath it
// is replaced. Usage, at the top of a test file:
//
//   vi.mock('idb-keyval', () => memoryIdb());
//
// and `resetMemoryIdb()` between tests.

const store = new Map<string, unknown>();

export function resetMemoryIdb(): void {
  store.clear();
}

export function memoryIdbStore(): Map<string, unknown> {
  return store;
}

export function memoryIdb() {
  return {
    get: async (key: string) => store.get(key),
    set: async (key: string, value: unknown) => {
      // Structured-clone semantics: IndexedDB stores a copy, not a live
      // reference. Skipping this would let a test mutate a "stored" object and
      // see the change come back, which IndexedDB would never do.
      store.set(key, structuredClone(value));
    },
    del: async (key: string) => {
      store.delete(key);
    },
    clear: async () => {
      store.clear();
    },
    keys: async () => [...store.keys()],
  };
}
