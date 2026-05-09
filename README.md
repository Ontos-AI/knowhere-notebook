# Knowhere Notebook

Upload documents, explore parsed content, and ask questions about your knowledge — powered by the Knowhere API.

## Getting Started

1. Copy the environment template:
   ```bash
   cp .env.local.example .env.local
   ```

2. Fill in your API keys in `.env.local`:
   - `AI_GATEWAY_API_KEY` — your Vercel AI Gateway key for chat (optional `CHAT_MODEL` override)

3. Install dependencies and run:
   ```bash
   pnpm install
   pnpm dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org) with App Router and Server Components
- **AI**: [Vercel AI SDK](https://sdk.vercel.ai) + [Vercel AI Gateway](https://vercel.com/docs/ai-gateway)
- **Knowledge**: [Knowhere Node.js SDK](https://github.com/Ontos-AI/knowhere-sdk) for document parsing and retrieval
- **UI**: [shadcn/ui](https://ui.shadcn.com) + Tailwind CSS 4
- **Icons**: [Lucide](https://lucide.dev)

## Project Structure

```
src/
├── app/              # Next.js App Router pages
│   ├── layout.tsx    # Root layout
│   ├── page.tsx      # Main three-panel view
│   └── globals.css   # Theme and global styles
├── components/       # React components
│   ├── app-header.tsx
│   ├── sources-panel.tsx
│   ├── chunks-panel.tsx
│   ├── chat-panel.tsx
│   └── ui/           # shadcn/ui primitives
└── lib/              # Shared utilities
    ├── ai.ts         # AI provider config
    ├── knowhere.ts   # Knowhere SDK client
    └── utils.ts      # Tailwind merge helper
```
