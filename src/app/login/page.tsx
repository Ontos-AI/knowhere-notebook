import { Suspense } from "react"
import { NotebookLogoMark } from "@/components/notebook-logo-mark";
import { Card, CardContent } from "@/components/ui/card";
import { connection } from "next/server";
import { listLoginProviders } from "@/infrastructure/auth/oauth-providers";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}

export async function LoginContent() {
  await connection()

  const providers = listLoginProviders()

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
            <LoginForm providers={providers} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
