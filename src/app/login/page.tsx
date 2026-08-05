import { Suspense } from "react"
import { useActionState } from "react";
import { NotebookLogoMark } from "@/components/notebook-logo-mark";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { connection } from "next/server";
import { loginAction, type LoginActionState } from "./actions";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}

const initialState: LoginActionState = { error: null };

function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

  return (
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
  );
}

export async function LoginContent() {
  await connection()

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#fafafa] p-4 text-[#09090b]">
      <Card className="m-auto w-full max-w-md rounded-2xl border-none bg-transparent shadow-none">
        <CardContent className="flex flex-col items-center p-8 text-center">
          <div className="mb-6 flex size-12 items-center justify-center">
            <NotebookLogoMark width={28} />
          </div>
          <h1 className="mb-1 text-2xl font-bold tracking-tight">
            Knowhere Notebook
          </h1>
          <p className="mb-8 text-xs text-[#71717b]">
            Sign in with your Notebook account.
          </p>
          <div className="w-full text-left">
            <LoginForm />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
