import { BookOpen } from "lucide-react";

export function AppHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border px-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <BookOpen className="h-4 w-4 text-primary-foreground" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">
          Knowhere Notebook
        </h1>
      </div>
    </header>
  );
}
