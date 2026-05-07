import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Workspace upsert tests.
 *
 * We mock the Drizzle client rather than spinning up Postgres: the
 * invariants we care about at the unit level are purely about call
 * ordering and idempotency. Integration against Neon is covered by a
 * later Playwright pass once DATABASE_URL is provisioned.
 */

type Row = { id: string; userId: string; namespace: string; createdAt: Date };

type SelectBuilder = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: (n: number) => Promise<Row[]>;
};

type InsertBuilder = {
  values: ReturnType<typeof vi.fn>;
  onConflictDoNothing: ReturnType<typeof vi.fn>;
};

type DbMock = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
};

function buildDbMock(storage: { row: Row | null }): DbMock {
  function makeSelect(): SelectBuilder {
    const builder: SelectBuilder = {
      from: vi.fn(() => builder),
      where: vi.fn(() => builder),
      limit: vi.fn(async () => (storage.row ? [storage.row] : [])),
    };
    return builder;
  }
  function makeInsert(): InsertBuilder {
    const builder: InsertBuilder = {
      values: vi.fn(function (this: InsertBuilder, values: Row) {
        if (!storage.row) {
          storage.row = {
            id: crypto.randomUUID(),
            userId: values.userId,
            namespace: values.namespace,
            createdAt: new Date(),
          };
        }
        return builder;
      }),
      onConflictDoNothing: vi.fn(async () => undefined),
    };
    return builder;
  }
  return {
    select: vi.fn(() => makeSelect()),
    insert: vi.fn(() => makeInsert()),
  };
}

async function loadWorkspace(dbMock: DbMock) {
  vi.resetModules();
  vi.doMock("./db", () => ({ db: dbMock }));
  return await import("./workspace");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ensureWorkspace", () => {
  it("returns the existing workspace on a warm call without inserting", async () => {
    const existing: Row = {
      id: "ws_1",
      userId: "user_1",
      namespace: "notebook-existing",
      createdAt: new Date(),
    };
    const storage = { row: existing };
    const dbMock = buildDbMock(storage);

    const { ensureWorkspace } = await loadWorkspace(dbMock);
    const got = await ensureWorkspace("user_1");

    expect(got).toEqual(existing);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("inserts a new workspace on the cold path with a derived namespace", async () => {
    const storage: { row: Row | null } = { row: null };
    const dbMock = buildDbMock(storage);

    const { ensureWorkspace } = await loadWorkspace(dbMock);
    const got = await ensureWorkspace("user_2");

    expect(dbMock.insert).toHaveBeenCalledOnce();
    expect(got.userId).toBe("user_2");
    expect(got.namespace).toMatch(/^notebook-[0-9a-f-]{36}$/);
  });

  it("is idempotent across concurrent first-time calls for the same user", async () => {
    const storage: { row: Row | null } = { row: null };
    const dbMock = buildDbMock(storage);

    const { ensureWorkspace } = await loadWorkspace(dbMock);
    const [a, b] = await Promise.all([
      ensureWorkspace("user_3"),
      ensureWorkspace("user_3"),
    ]);

    expect(a.id).toBe(b.id);
    expect(a.namespace).toBe(b.namespace);
    expect(a.userId).toBe("user_3");
  });
});
