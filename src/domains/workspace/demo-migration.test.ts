import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

describe("demo source migration", () => {
  it("backfills visibility rows for deleted legacy demo sources", () => {
    const migrationSql: string = readFileSync(
      join(process.cwd(), "drizzle/0007_normalize_legacy_demo_sources.sql"),
      "utf8",
    )

    expect(migrationSql).toContain('INSERT INTO "demo_source_visibilities"')
    expect(migrationSql).toContain('"demo_key" IS NOT NULL')
    expect(migrationSql).toContain('"deleted_at" IS NOT NULL')
    expect(migrationSql).toContain(
      'ON CONFLICT ("workspace_id", "demo_source_id") DO UPDATE',
    )
  })
})
