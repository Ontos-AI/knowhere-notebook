import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Login gate preview for the MVP shell. The real auth redirect is handled by
 * server-side guards; this page keeps direct `/login` visits user-friendly.
 */
export default function LoginPage() {
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
          <Link href="/" className="w-full">
            <Button size="lg" className="w-full rounded-xl py-6">
              Sign in
            </Button>
          </Link>
          <p className="mt-4 text-xs text-muted-foreground">
            Use your Knowhere account to continue.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
