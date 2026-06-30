import { describe, expect, it } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"

import { buildAtomicAssetUrlsMergeSql } from "./source-parse-result-repository"

describe("sourceParseResultRepository", () => {
  it("builds an atomic JSONB merge expression for asset progress", () => {
    const mergeSql = buildAtomicAssetUrlsMergeSql({
      "images/image-2.png": "https://blob.example/images/image-2.png",
    })
    const query = new PgDialect().sqlToQuery(mergeSql)

    expect(query.sql).toContain(
      '"source_parse_results"."asset_urls" || $1::jsonb',
    )
    expect(query.params).toContain(
      '{"images/image-2.png":"https://blob.example/images/image-2.png"}',
    )
  })
})
