// In-memory stand-in for node-appwrite's TablesDB, for tests of the Appwrite
// API function. Counts `reads` the way Appwrite bills them: one per returned
// row. Supports the query methods the function uses (node-appwrite serialises
// every Query.* call to JSON).

type Row = Record<string, unknown> & { $id: string; $createdAt: string; $updatedAt: string };
type Q = { method: string; attribute?: string; values?: unknown[] };

function matches(r: Record<string, unknown>, q: Q): boolean {
  const v = q.values ?? [];
  const x = q.attribute === undefined ? undefined : r[q.attribute];
  switch (q.method) {
    case 'equal': return v.includes(x);
    case 'greaterThan': return x != null && String(x) > String(v[0]);
    case 'lessThan': return x != null && String(x) < String(v[0]);
    case 'between': return x != null && String(x) >= String(v[0]) && String(x) <= String(v[1]);
    case 'isNotNull': return x != null;
    case 'isNull': return x == null;
    case 'or': return (v as Q[]).some((sub) => matches(r, sub));
    case 'and': return (v as Q[]).every((sub) => matches(r, sub));
    default: return true; // limit, cursor, order, select
  }
}

export class FakeTablesDb {
  tables = new Map<string, Map<string, Row>>();
  reads = 0;
  listCalls = 0;
  // Real time plus whatever tick() added, so timestamps line up with the
  // `new Date()` the function itself uses.
  private offset = 0;
  private tx = new Map<string, Array<() => void>>();
  private seq = 0;

  constructor(tableIds: string[]) {
    for (const id of tableIds) this.tables.set(id, new Map());
  }

  /** Advance the fake server clock (row timestamps come from it). */
  tick(ms = 1000): string { this.offset += ms; return this.now(); }
  now(): string { return new Date(Date.now() + this.offset).toISOString(); }
  dropTable(id: string): void { this.tables.delete(id); }

  private table(tableId: string): Map<string, Row> {
    const t = this.tables.get(tableId);
    if (!t) throw Object.assign(new Error(`Table ${tableId} not found`), { code: 404 });
    return t;
  }

  seed(tableId: string, rows: Array<Record<string, unknown>>): void {
    const t = this.table(tableId);
    for (const r of rows) {
      const $id = String(r.$id ?? r.legacyId ?? `r${++this.seq}`);
      t.set($id, { ...r, $id, $createdAt: this.now(), $updatedAt: this.now() });
    }
  }

  async listRows({ tableId, queries = [] }: { databaseId: string; tableId: string; queries?: string[]; total?: boolean }) {
    this.listCalls++;
    const qs = queries.map((q) => JSON.parse(q) as Q);
    let rows = [...this.table(tableId).values()];
    for (const q of qs) rows = rows.filter((r) => matches(r, q));
    rows.sort((x, y) => x.$id.localeCompare(y.$id));
    for (const q of qs) {
      const a = q.attribute!;
      if (q.method === 'orderAsc') rows.sort((x, y) => String(x[a]).localeCompare(String(y[a])));
      if (q.method === 'orderDesc') rows.sort((x, y) => String(y[a]).localeCompare(String(x[a])));
    }
    const cursor = qs.find((q) => q.method === 'cursorAfter')?.values?.[0];
    if (cursor !== undefined) rows = rows.slice(rows.findIndex((r) => r.$id === cursor) + 1);
    const limit = qs.find((q) => q.method === 'limit')?.values?.[0] as number | undefined;
    rows = rows.slice(0, limit ?? 25);
    this.reads += rows.length;
    return { rows: rows.map((r) => ({ ...r })), total: rows.length };
  }

  async getRow({ tableId, rowId }: { databaseId: string; tableId: string; rowId: string }) {
    const r = this.table(tableId).get(rowId);
    if (!r) throw Object.assign(new Error('Row not found'), { code: 404 });
    this.reads += 1;
    return { ...r };
  }

  private run<T>(transactionId: string | undefined, op: () => T): T | undefined {
    if (!transactionId) return op();
    this.tx.get(transactionId)!.push(op);
    return undefined;
  }

  async createRow({ tableId, rowId, data, transactionId }: { databaseId: string; tableId: string; rowId: string; data: Record<string, unknown>; transactionId?: string }) {
    const t = this.table(tableId);
    const id = rowId === 'unique()' ? `u${++this.seq}` : rowId;
    return this.run(transactionId, () => {
      const row = { ...data, $id: id, $createdAt: this.now(), $updatedAt: this.now() } as Row;
      t.set(id, row);
      return { ...row };
    });
  }

  async upsertRow({ tableId, rowId, data }: { databaseId: string; tableId: string; rowId: string; data: Record<string, unknown> }) {
    const t = this.table(tableId);
    const old = t.get(rowId);
    const row = { ...(old ?? {}), ...data, $id: rowId, $createdAt: old?.$createdAt ?? this.now(), $updatedAt: this.now() } as Row;
    t.set(rowId, row);
    return { ...row };
  }

  async updateRow({ tableId, rowId, data }: { databaseId: string; tableId: string; rowId: string; data: Record<string, unknown> }) {
    const t = this.table(tableId);
    const old = t.get(rowId);
    if (!old) throw Object.assign(new Error('Row not found'), { code: 404 });
    const row = { ...old, ...data, $updatedAt: this.now() } as Row;
    t.set(rowId, row);
    return { ...row };
  }

  async deleteRow({ tableId, rowId, transactionId }: { databaseId: string; tableId: string; rowId: string; transactionId?: string }) {
    const t = this.table(tableId);
    return this.run(transactionId, () => { t.delete(rowId); });
  }

  async createTransaction() {
    const id = `tx${++this.seq}`;
    this.tx.set(id, []);
    return { $id: id };
  }

  async updateTransaction({ transactionId, commit }: { transactionId: string; commit?: boolean; rollback?: boolean }) {
    const ops = this.tx.get(transactionId) ?? [];
    this.tx.delete(transactionId);
    if (commit) for (const op of ops) op();
    return {};
  }
}

/** Minimal Appwrite function context; returns what the handler replied. */
export function fakeContext(method: string, url: string, body?: unknown) {
  const out: { status?: number; body?: unknown } = {};
  const req = { method, url, path: url, headers: { 'x-appwrite-user-jwt': 'jwt' }, bodyText: body === undefined ? '' : JSON.stringify(body) };
  const res = {
    json: (b: unknown, status = 200) => { out.status = status; out.body = b; return out; },
    send: (b: unknown, status = 200) => { out.status = status; out.body = b; return out; },
    text: (b: unknown, status = 200) => { out.status = status; out.body = b; return out; },
  };
  const errors: string[] = [];
  return { ctx: { req, res, error: (m: string) => errors.push(m), log: () => {} }, out, errors };
}
