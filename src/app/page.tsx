import { SourcesPanel } from "@/components/sources-panel";
import { ChunksPanel } from "@/components/chunks-panel";
import { ChatPanel } from "@/components/chat-panel";
import { AppHeader } from "@/components/app-header";

export default function Home() {
  return (
    <div className="flex h-full flex-col">
      <AppHeader />
      <main className="flex flex-1 overflow-hidden">
        <SourcesPanel />
        <ChunksPanel />
        <ChatPanel />
      </main>
    </div>
  );
}
