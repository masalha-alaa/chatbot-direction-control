// Shared in-memory Chrome storage with events delivered to every context.
function storageHarness(initial = {}) {
  const data = { ...initial };
  const listeners = new Set();
  const writes = [];
  const reads = [];
  let fail = false;
  const emit = changes => listeners.forEach(fn => fn(changes, "local"));
  const storage = {
    onChanged: { addListener: fn => listeners.add(fn) },
    local: {
      async get(keys) {
        if (fail) throw new Error("Storage unavailable");
        reads.push(keys);
        return Object.fromEntries((typeof keys === "string" ? [keys] : keys).filter(k => k in data).map(k => [k, data[k]]));
      },
      async set(values) {
        if (fail) throw new Error("Storage unavailable");
        writes.push(values);
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
          changes[key] = { oldValue: data[key], newValue: value };
          data[key] = value;
        }
        emit(changes);
      },
      async remove(key) {
        if (fail) throw new Error("Storage unavailable");
        delete data[key];
        emit({ [key]: {} });
      }
    }
  };
  return { data, storage, writes, reads, emit, setFailure(value) { fail = value; } };
}
module.exports = { storageHarness };
