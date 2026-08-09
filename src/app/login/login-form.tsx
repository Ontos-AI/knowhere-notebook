"use client"

import { useActionState, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { loginAction, type LoginActionState } from "./actions"

const initialState: LoginActionState = { error: null }

export type LoginProvider = {
  readonly name: string
  readonly displayName: string
}

export function LoginForm({
  providers = [],
}: {
  readonly providers?: readonly LoginProvider[];
}) {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);
  const [oauthProvider, setOauthProvider] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);

  async function handleOAuth(provider: string): Promise<void> {
    setOauthProvider(provider);
    setProviderError(null);
    try {
      const response = await fetch(`/api/auth/${encodeURIComponent(provider)}/start`);
      const body = (await response.json()) as { url?: string; message?: string };
      if (body.url) {
        const anchor = document.createElement("a");
        anchor.href = body.url;
        anchor.click();
        return;
      }
      setProviderError(body.message ?? "Sign-in could not be started.");
      setOauthProvider(null);
    } catch {
      setProviderError("Sign-in could not be started.");
      setOauthProvider(null);
    }
  }

  return (
    <div className="grid gap-4">
      {providers.length > 0 ? (
        <>
          <div className="grid gap-2">
            {providers.map((provider) => (
              <Button
                key={provider.name}
                type="button"
                variant="outline"
                className="w-full"
                disabled={oauthProvider !== null}
                onClick={() => void handleOAuth(provider.name)}
              >
                {oauthProvider === provider.name
                  ? "Redirecting…"
                  : provider.name === "dashboard"
                    ? "SSO (Dashboard)"
                    : `Continue with ${provider.displayName}`}
              </Button>
            ))}
          </div>
          {providerError ? (
            <p className="text-xs font-semibold text-destructive">{providerError}</p>
          ) : null}
          <Separator className="my-1" />
        </>
      ) : null}
      <form action={formAction} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        {state.error ? (
          <p className="text-xs font-semibold text-destructive">{state.error}</p>
        ) : null}
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
