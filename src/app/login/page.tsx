import Link from "next/link";
import { BookOpen } from "lucide-react";
import { headers } from "next/headers";
import { Card, CardContent } from "@/components/ui/card";
import { authURLs } from "@/lib/auth-urls";

/**
 * Login gate preview for the MVP shell. The real auth redirect is handled by
 * server-side guards; this page keeps direct `/login` visits user-friendly.
 */
export default async function LoginPage() {
  const notebookPublicURL =
    process.env.NOTEBOOK_PUBLIC_URL ??
    authURLs.resolveNotebookPublicURLFromHeaders(await headers());
  const loginHref = authURLs.buildDashboardLoginURL(
    requireEnv("DASHBOARD_LOGIN_URL"),
    notebookPublicURL,
  );

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4 text-foreground">
      <Card className="m-auto w-full max-w-md rounded-2xl border-none bg-transparent shadow-none">
        <CardContent className="flex flex-col items-center p-8 text-center">
          <div className="mb-6 flex size-12 items-center justify-center rounded-xl bg-primary">
            <BookOpen className="size-7 text-primary-foreground" />
          </div>
          <h1 className="mb-8 text-2xl font-bold tracking-tight">
            Knowhere Notebook
          </h1>
          <Link
            href={loginHref}
            className="inline-flex h-9 w-full items-center justify-center rounded-xl bg-primary px-2.5 py-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Sign in
          </Link>
          <p className="mt-4 text-xs text-muted-foreground">
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
