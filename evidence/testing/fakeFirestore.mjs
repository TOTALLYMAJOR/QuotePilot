// A minimal in-memory stand-in for the Firestore Admin handle.
//
// It implements only what the reader uses — doc/collection/get/limit/orderBy —
// so the reader's containment properties can be tested as always-on unit tests
// rather than only in the emulator lane. It deliberately does NOT implement
// collectionGroup: if the reader ever reaches for one, these tests fail loudly
// instead of quietly allowing a cross-tenant query.

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class FakeQuery {
  constructor(store, prefix, { limit = 0, orderBy = null } = {}) {
    this.store = store;
    this.prefix = prefix;
    this._limit = limit;
    this._orderBy = orderBy;
  }

  limit(count) {
    return new FakeQuery(this.store, this.prefix, { limit: count, orderBy: this._orderBy });
  }

  orderBy(field, direction = "asc") {
    return new FakeQuery(this.store, this.prefix, {
      limit: this._limit,
      orderBy: { field, direction }
    });
  }

  async get() {
    const depth = this.prefix.split("/").length + 1;
    let entries = Object.entries(this.store)
      .filter(([path]) => path.startsWith(`${this.prefix}/`) && path.split("/").length === depth)
      .map(([path, data]) => ({ id: path.split("/").pop(), data: () => clone(data), exists: true }));

    if (this._orderBy) {
      const { field, direction } = this._orderBy;
      entries.sort((left, right) => {
        const a = String(left.data()?.[field] ?? "");
        const b = String(right.data()?.[field] ?? "");
        return direction === "desc" ? b.localeCompare(a) : a.localeCompare(b);
      });
    } else {
      entries.sort((left, right) => left.id.localeCompare(right.id));
    }
    if (this._limit > 0) entries = entries.slice(0, this._limit);
    return { docs: entries, size: entries.length, empty: entries.length === 0 };
  }
}

class FakeDocument {
  constructor(store, path) {
    this.store = store;
    this.path = path;
    this.id = path.split("/").pop();
  }

  collection(name) {
    return new FakeCollection(this.store, `${this.path}/${name}`);
  }

  async get() {
    const data = this.store[this.path];
    return {
      id: this.id,
      exists: data !== undefined,
      data: () => clone(data)
    };
  }
}

class FakeCollection extends FakeQuery {
  constructor(store, prefix) {
    super(store, prefix);
  }

  doc(id) {
    return new FakeDocument(this.store, `${this.prefix}/${id}`);
  }
}

/**
 * @param {Record<string, object>} documents Map of full document path -> data.
 */
export function fakeFirestore(documents = {}) {
  const store = { ...documents };
  return {
    collection: (name) => new FakeCollection(store, name),
    // Intentionally absent: collectionGroup. Reaching for it is a test failure.
    _store: store
  };
}
