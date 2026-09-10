import "server-only"

export type MementoConfig = {
  readonly baseUrl: string
  readonly serviceKey: string
}

export function readMementoConfig(): MementoConfig {
  const baseUrl = process.env.MEMENTO_BASE_URL
  const serviceKey = process.env.MEMENTO_SERVICE_KEY
  if (!baseUrl) {
    throw new Error("MEMENTO_BASE_URL is required.")
  }
  if (!serviceKey) {
    throw new Error("MEMENTO_SERVICE_KEY is required.")
  }
  return { baseUrl, serviceKey }
}
