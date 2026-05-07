import type { RetrievalQueryParams, RetrievalResult } from "@ontos-ai/knowhere-sdk";
import { generateText } from "ai";

import { assertAIGatewayConfigured, CHAT_MODEL } from "./ai";
import type { Source } from "./schema";

const DEFAULT_TOP_K = 8;
const NO_RESULTS_ANSWER = "I couldn't find that in your sources.";

export type RetrievalClient = {
  query(params: RetrievalQueryParams): Promise<{ results: RetrievalResult[] }>;
};

export type GenerateAnswer = (input: {
  question: string;
  results: readonly RetrievalResult[];
}) => Promise<string>;

export type AnswerQuestionInput = {
  question: string;
  namespace: string;
  sources: readonly Source[];
  excludedSourceIds: readonly string[];
  retrieval: RetrievalClient;
  generateAnswer: GenerateAnswer;
};

export type AnswerQuestionResult = {
  answer: string;
  citations: RetrievalResult[];
};

export type ParsedChatRequest = {
  question: string;
  threadId?: string;
  excludedSourceIds: string[];
};

export type ParseChatRequestResult =
  | { ok: true; value: ParsedChatRequest }
  | { ok: false; message: string; status: 400 };

export async function answerQuestionWithRetrieval(
  input: AnswerQuestionInput,
): Promise<AnswerQuestionResult> {
  const query = input.question.trim();
  const response = await input.retrieval.query({
    namespace: input.namespace,
    query,
    topK: DEFAULT_TOP_K,
    ...excludeDocuments(input.sources, input.excludedSourceIds),
  });

  if (response.results.length === 0) {
    return { answer: NO_RESULTS_ANSWER, citations: [] };
  }

  const answer = await input.generateAnswer({
    question: query,
    results: response.results,
  });
  return { answer, citations: response.results };
}

export async function generateGroundedAnswer(input: {
  question: string;
  results: readonly RetrievalResult[];
}): Promise<string> {
  assertAIGatewayConfigured();
  const response = await generateText({
    model: CHAT_MODEL,
    prompt: buildGroundedPrompt(input),
  });
  return response.text.trim();
}

export function buildGroundedPrompt(input: {
  question: string;
  results: readonly RetrievalResult[];
}): string {
  const sources = input.results
    .map((result, index) => {
      const sourceName = result.source.sourceFileName ?? "Unknown source";
      const section = result.source.sectionPath
        ? ` (${result.source.sectionPath})`
        : "";
      return [
        `[${index + 1}] ${sourceName}${section}`,
        result.content,
      ].join("\n");
    })
    .join("\n\n");

  return [
    "Answer the user's question using only the source excerpts below.",
    "If the sources do not answer the question, say you could not find it in the sources.",
    "Keep the answer concise and cite the relevant source names naturally.",
    "",
    `Question: ${input.question}`,
    "",
    "Source excerpts:",
    sources,
  ].join("\n");
}

export function parseChatRequestBody(body: unknown): ParseChatRequestResult {
  if (!isObject(body)) {
    return {
      ok: false,
      message: "Enter a question before sending.",
      status: 400,
    };
  }

  const message = body.message;
  const question = typeof message === "string" ? message.trim() : "";
  if (question.length === 0) {
    return {
      ok: false,
      message: "Enter a question before sending.",
      status: 400,
    };
  }

  const threadId = typeof body.threadId === "string" && body.threadId.length > 0
    ? body.threadId
    : undefined;
  const excludedSourceIds = Array.isArray(body.excludedSourceIds)
    ? body.excludedSourceIds.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    : [];

  return {
    ok: true,
    value: { question, threadId, excludedSourceIds },
  };
}

function excludeDocuments(
  sources: readonly Source[],
  excludedSourceIds: readonly string[],
): Pick<RetrievalQueryParams, "excludeDocumentIds"> {
  const excluded = new Set(excludedSourceIds);
  const documentIds = sources
    .filter((source) => excluded.has(source.id))
    .map((source) => source.knowhereDocumentId)
    .filter((documentId): documentId is string => Boolean(documentId));

  return documentIds.length > 0 ? { excludeDocumentIds: documentIds } : {};
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
