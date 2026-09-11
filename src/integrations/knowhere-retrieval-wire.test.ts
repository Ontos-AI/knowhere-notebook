import { createServer } from "node:http"
import { once } from "node:events"
import { afterEach, describe, expect, it } from "vitest"
import type { RetrievalQueryParams } from "@ontos-ai/knowhere-sdk"

import { makeKnowhereClient } from "./knowhere"

describe("makeKnowhereClient retrieval wire payload", () => {
  const originalBaseURL = process.env.KNOWHERE_BASE_URL

  afterEach(() => {
    restoreEnv("KNOWHERE_BASE_URL", originalBaseURL)
  })

  it.each<{
    name: string
    params: RetrievalQueryParams
    body: string
  }>([
    {
      name: "serializes overlapping include and exclude IDs",
      params: {
        query: "battery charging",
        includeDocumentIds: ["doc_123", "doc_old"],
        excludeDocumentIds: ["doc_old"],
      } as RetrievalQueryParams,
      body: '{"query":"battery charging","include_document_ids":["doc_123","doc_old"],"exclude_document_ids":["doc_old"]}',
    },
    {
      name: "preserves empty inclusion and exclusion arrays",
      params: {
        query: "battery charging",
        includeDocumentIds: [],
        excludeDocumentIds: [],
      } as RetrievalQueryParams,
      body: '{"query":"battery charging","include_document_ids":[],"exclude_document_ids":[]}',
    },
    {
      name: "omits document filters when not supplied",
      params: { query: "battery charging" },
      body: '{"query":"battery charging"}',
    },
  ])("$name", async ({ params, body }) => {
    let receivedBody = ""
    let receivedMethod: string | undefined
    let receivedUrl: string | undefined
    const server = createServer((request, response) => {
      receivedMethod = request.method
      receivedUrl = request.url
      request.setEncoding("utf8")
      request.on("data", (chunk: string) => {
        receivedBody += chunk
      })
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end('{"results":[]}')
      })
    })

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const address = server.address()
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address")
      }
      process.env.KNOWHERE_BASE_URL = `http://127.0.0.1:${address.port}`
      const client = makeKnowhereClient("scope-test")

      await client.retrieval.query(params)

      expect(receivedMethod).toBe("POST")
      expect(receivedUrl).toBe("/v2/retrieval/query")
      expect(receivedBody).toBe(body)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      })
    }
  })
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}
