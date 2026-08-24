import type {
  AssistantAnswer,
  NormalizedConversationMessage,
  NormalizedConversationThread,
  PatientMemoryContext,
  Tier1PatientContext,
} from "@/lib/domain/types";

const categoryTags: Record<string, string[]> = {
  shipment: ["shipping", "refill", "problem_shipment"],
  billing: ["billing", "account", "cancellation"],
  appointment: ["appointment", "returning_patient"],
  checkin: ["treatment_faq", "urgent", "suicidality-at-risk"],
  side_effect: ["side_effect", "urgent"],
  form: ["onboarding", "account"],
  dose: ["dose", "returning_patient", "urgent"],
  next_step: ["account", "onboarding", "urgent", "returning_patient", "problem_shipment"],
};

const ignoredQueryWords = new Set([
  "about", "again", "anything", "care", "does", "have", "just", "know", "message", "please",
  "last", "previously", "said", "team", "that", "the", "their", "there", "they", "this", "told", "what", "when", "where", "which",
  "with", "would", "your",
]);

function queryTerms(message: string): string[] {
  return [...new Set(
    message
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((term) => term.length > 3 && !ignoredQueryWords.has(term)),
  )];
}

function searchableThreadText(thread: NormalizedConversationThread): string {
  return [
    ...thread.tags,
    thread.unresolved_request ?? "",
    thread.review_flag ?? "",
    ...thread.messages.map((message) => message.text),
  ].join(" ").toLowerCase();
}

function relevanceScore(
  thread: NormalizedConversationThread,
  message: string,
  category: string,
): number {
  const expectedTags = new Set(categoryTags[category] ?? []);
  const text = searchableThreadText(thread);
  const matchingTags = thread.tags.filter((tag) => expectedTags.has(tag)).length;
  const matchingTerms = queryTerms(message).filter((term) => text.includes(term)).length;
  const asksAboutHistory = /\b(?:already|before|earlier|last time|message|said|told|conversation|reply|respond)\b/i.test(message);
  const asksAboutOwnMessage = /\b(?:my (?:last )?message|did anyone (?:get|see)|reply to me|respond to me)\b/i.test(message);
  const broadContinuityQuestion = category === "overview" || category === "next_step";
  const hasSemanticMatch = matchingTags > 0 || matchingTerms > 0;
  const continuityEligible =
    (broadContinuityQuestion && !asksAboutHistory) ||
    asksAboutOwnMessage ||
    (asksAboutHistory && hasSemanticMatch);

  if (asksAboutOwnMessage && !thread.latestPatientMessageAt) return 0;
  if (!broadContinuityQuestion && matchingTags === 0 && matchingTerms < (asksAboutHistory ? 1 : 2)) {
    return 0;
  }

  return (
    matchingTags * 8 +
    matchingTerms * 3 +
    (thread.status === "open" && continuityEligible ? 5 : 0) +
    (thread.unresolved_request && continuityEligible ? 3 : 0) +
    (thread.review_flag && (hasSemanticMatch || asksAboutHistory) ? 4 : 0) +
    (asksAboutHistory && hasSemanticMatch ? 3 : 0)
  );
}

function safeMessage(message: NormalizedConversationMessage) {
  if (!message.internal) {
    return {
      sentAt: message.sent_at,
      from: message.from,
      text: message.text,
    };
  }

  return {
    sentAt: message.sent_at,
    from: "staff_activity" as const,
    text: /outbound call attempted/i.test(message.text)
      ? "A Nurse Team outbound call attempt and voicemail are recorded; another attempt was planned."
      : "A staff activity was recorded in this thread; internal note text is not exposed.",
  };
}

export interface SelectedMemoryThread {
  threadId: string;
  openedAt: string;
  latestMessageAt: string;
  channel: string;
  status: string;
  tags: string[];
  escalatedTo: string | null;
  unresolvedRequest: string | null;
  priorAnswerReviewFlag: string | null;
  awaitingStaffReply: boolean;
  messages: ReturnType<typeof safeMessage>[];
}

export interface SelectedConversationMemory {
  threads: SelectedMemoryThread[];
  sources: string[];
}

export function selectRelevantMemory(
  memory: PatientMemoryContext | undefined,
  message: string,
  category: string,
  limit = 3,
): SelectedConversationMemory {
  if (!memory?.threads.length) return { threads: [], sources: [] };

  const ranked = memory.threads
    .map((thread) => ({ thread, score: relevanceScore(thread, message, category) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.thread.latestMessageAt.localeCompare(a.thread.latestMessageAt))
    .slice(0, limit)
    .map(({ thread }) => ({
      threadId: thread.thread_id,
      openedAt: thread.opened_at,
      latestMessageAt: thread.latestMessageAt,
      channel: thread.channel,
      status: thread.status,
      tags: thread.tags,
      escalatedTo: thread.escalated_to,
      unresolvedRequest: thread.unresolved_request ?? null,
      priorAnswerReviewFlag: thread.review_flag ?? null,
      awaitingStaffReply: Boolean(
        thread.status === "open" &&
          thread.latestPatientMessageAt &&
          !thread.hasStaffReplyAfterLatestPatientMessage,
      ),
      messages: thread.messages.slice(-8).map(safeMessage),
    }));

  return {
    threads: ranked,
    sources: ranked.map(
      (thread) => `tier2_memory/conversations.json#${thread.threadId}`,
    ),
  };
}

function formatDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: year === 2026 ? undefined : "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function teamLabel(team: string | null): string | null {
  if (team === "care_team") return "Care Team";
  if (team === "nurse_team") return "Nurse Team";
  return null;
}

export function applyConversationMemory(
  context: Tier1PatientContext,
  message: string,
  baseline: AssistantAnswer,
): AssistantAnswer {
  if (["crisis", "urgent_medical", "third_party_safety"].includes(baseline.category)) {
    return baseline;
  }

  const selected = selectRelevantMemory(context.memory, message, baseline.category);
  const primary = selected.threads[0];
  if (!primary) return baseline;

  const explicitlyAsksAboutMemory = /\b(?:already|before|earlier|last time|message|said|told|conversation|reply|respond|any word|hear back)\b/i.test(message);
  if (primary.status !== "open" && !primary.priorAnswerReviewFlag && !explicitlyAsksAboutMemory) {
    return baseline;
  }

  const details = [
    primary.status === "open"
      ? `Your ${formatDate(primary.openedAt)} conversation about ${primary.tags.join(" and ")} is still marked open.`
      : `I found a previous ${formatDate(primary.openedAt)} conversation about ${primary.tags.join(" and ")}.`,
    primary.escalatedTo
      ? `It is recorded as escalated to the ${teamLabel(primary.escalatedTo)}, but this assistant has not sent a new message.`
      : null,
    primary.awaitingStaffReply
      ? "There is no later Care Team or Nurse Team reply recorded after your latest message in that thread."
      : null,
    primary.priorAnswerReviewFlag
      ? "An earlier assistant answer in that thread was flagged as unreliable, so the current structured record takes precedence."
      : null,
  ].filter((detail): detail is string => Boolean(detail));

  return {
    ...baseline,
    answer: `${baseline.answer} ${details.join(" ")}`,
    facts: [
      ...baseline.facts,
      {
        label: "Prior conversation",
        value: primary.status === "open" ? `Open since ${formatDate(primary.openedAt)}` : formatDate(primary.openedAt),
        tone: primary.status === "open" ? "attention" : undefined,
      },
    ],
    sources: [...new Set([...baseline.sources, ...selected.sources])],
  };
}
