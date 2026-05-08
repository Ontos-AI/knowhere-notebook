"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Check, Key, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

type ApiKeyStatus = "active" | "failed" | "missing"

export function ApiKeySettings() {
  const [status, setStatus] = useState<ApiKeyStatus | null>(null)
  const [isRecreating, setIsRecreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/api-key")
      if (!response.ok) return
      const body = (await response.json()) as { status: ApiKeyStatus }
      setStatus(body.status)
    } catch {
      // Silently ignore — status stays null until the next poll
    }
  }, [])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  async function handleRecreate() {
    setIsRecreating(true)
    setError(null)
    try {
      const response = await fetch("/api/settings/api-key", { method: "POST" })
      if (!response.ok) {
        const body = (await response.json()) as { message?: string }
        setError(body.message ?? "Failed to recreate API key.")
        return
      }
      setStatus("active")
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setIsRecreating(false)
    }
  }

  if (status === null) return null

  return (
    <div className="flex items-center gap-2">
      {status === "active" && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Check className="size-3 text-green-500" />
          API key active
        </span>
      )}
      {status === "failed" && (
        <div className="inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="size-3" />
            API key failed
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRecreate}
            disabled={isRecreating}
            className="h-7 text-xs"
          >
            {isRecreating ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Key className="size-3" />
            )}
            <span className="ml-1">Recreate</span>
          </Button>
          {error && (
            <span className="text-xs text-destructive">{error}</span>
          )}
        </div>
      )}
      {status === "missing" && (
        <div className="inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <AlertTriangle className="size-3" />
            No API key
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRecreate}
            disabled={isRecreating}
            className="h-7 text-xs"
          >
            {isRecreating ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Key className="size-3" />
            )}
            <span className="ml-1">Create</span>
          </Button>
          {error && (
            <span className="text-xs text-destructive">{error}</span>
          )}
        </div>
      )}
    </div>
  )
}
