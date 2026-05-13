import { Suspense } from "react"
import Link from "next/link";
import { NotebookLogoMark } from "@/components/notebook-logo-mark";
import { headers } from "next/headers";
import { Card, CardContent } from "@/components/ui/card";
import { authURLs } from "@/infrastructure/auth/urls";
import { connection } from "next/server";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}

export async function LoginContent() {
  await connection()
  const notebookPublicURL =
    process.env.NOTEBOOK_PUBLIC_URL ??
    authURLs.resolveNotebookPublicURLFromHeaders(await headers());
  const loginHref = authURLs.buildDashboardLoginURL(
    `${requireEnv("DASHBOARD_ORIGIN")}/login`,
    notebookPublicURL,
  );

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#fafafa] p-4 text-[#09090b]">
      <Card className="m-auto w-full max-w-md rounded-2xl border-none bg-transparent shadow-none">
        <CardContent className="flex flex-col items-center p-8 text-center">
          <div className="mb-6 flex size-12 items-center justify-center">
            <NotebookLogoMark width={28} />
          </div>
          <h1 className="mb-8 text-2xl font-bold tracking-tight">
            Knowhere Notebook
          </h1>
          <Link
            href={loginHref}
            className="inline-flex h-9 w-full items-center justify-center rounded-xl bg-[#2563eb] px-2.5 py-6 text-sm font-medium text-white transition-colors hover:bg-[#2563eb]/90"
          >
            Sign in
          </Link>
          <p className="mt-4 text-xs text-[#71717b]">
            Use your Knowhere account to continue.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}
