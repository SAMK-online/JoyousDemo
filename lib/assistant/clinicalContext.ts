import type {
  AssistantAnswer,
  ClinicalVisitContext,
  PatientClinicalContext,
  Tier1PatientContext,
} from "@/lib/domain/types";

const categoryTopics: Record<string, string[]> = {
  shipment: ["refill", "approval"],
  billing: ["approval"],
  appointment: ["monitoring", "refill"],
  checkin: ["monitoring", "safety"],
  side_effect: ["monitoring", "dose"],
  form: ["identity", "approval"],
  dose: ["dose", "monitoring", "safety"],
  next_step: ["approval", "identity", "monitoring", "refill"],
};

const ignoredTerms = new Set([
  "about", "after", "again", "because", "could", "does", "have", "should", "that", "their",
  "there", "they", "this", "told", "what", "when", "where", "which", "with", "would", "your",
]);

function terms(value: string): string[] {
  return [...new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter(
        (term) =>
          (term.length > 3 || /^\d+$/.test(term) || term === "mg") &&
          !ignoredTerms.has(term),
      ),
  )];
}

function clinicalQuestion(message: string): boolean {
  const asksForReasoning = /\b(?:why|reason|clinical|documented plan|restart|monitoring plan|titration|titrate)\b/i.test(message);
  const asksWhatClinicianSaid =
    /\b(?:provider|nurse)\b[^.!?]{0,50}\b(?:said|say|told|tell|documented|recommended|decided|explained|planned)\b/i.test(message) ||
    /\bwhat\b[^.!?]{0,35}\b(?:provider|nurse)\b[^.!?]{0,35}\b(?:said|say|documented|recommended|planned)\b/i.test(message);
  return asksForReasoning || asksWhatClinicianSaid;
}

function visitScore(visit: ClinicalVisitContext, message: string, category: string): number {
  const expectedTopics = new Set(categoryTopics[category] ?? []);
  const topicMatches = visit.topics.filter((topic) => expectedTopics.has(topic)).length;
  const searchable = [
    ...visit.topics,
    ...visit.providerStatements,
    ...visit.documentedPlan,
  ].join(" ").toLowerCase();
  const termMatches = terms(message).filter((term) => searchable.includes(term)).length;

  return topicMatches * 7 + termMatches * 3 + (clinicalQuestion(message) ? 2 : 0);
}

export interface SelectedClinicalVisit {
  noteId: string;
  meetingId: string;
  date: string;
  meetingType: string;
  topics: string[];
  providerStatements: string[];
  documentedPlan: string[];
  internalLinesRedacted: number;
}

export interface SelectedClinicalContext {
  visits: SelectedClinicalVisit[];
  sources: string[];
}

export function selectRelevantClinicalContext(
  clinical: PatientClinicalContext | undefined,
  message: string,
  category: string,
  limit = 2,
): SelectedClinicalContext {
  if (!clinical?.visits.length) return { visits: [], sources: [] };
  if (!clinicalQuestion(message)) {
    return { visits: [], sources: [] };
  }

  const ranked = clinical.visits
    .map((visit) => ({ visit, score: visitScore(visit, message, category) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.visit.date.localeCompare(a.visit.date));
  const effectiveLimit = ranked[1] && ranked[0].score - ranked[1].score >= 3 ? 1 : limit;
  const visits = ranked
    .slice(0, effectiveLimit)
    .map(({ visit }) => ({
      noteId: visit.noteId,
      meetingId: visit.meetingId,
      date: visit.date,
      meetingType: visit.meetingType,
      topics: visit.topics,
      providerStatements: visit.providerStatements,
      documentedPlan: visit.documentedPlan,
      internalLinesRedacted: visit.redactedInternalLineCount,
    }));

  return {
    visits,
    sources: visits.map((visit) => `tier3_clinical/visit_notes.json#${visit.noteId}`),
  };
}

function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function evidenceScore(value: string, message: string, category: string): number {
  const queryMatches = terms(message).filter((term) => value.toLowerCase().includes(term)).length;
  const categoryTerms = categoryTopics[category] ?? [];
  const topicMatch = categoryTerms.length
    ? new RegExp(categoryTerms.join("|"), "i").test(value)
    : false;
  const explainsWhy = /\b(?:why|reason)\b/i.test(message) &&
    /\b(?:because|reason|due to|two reasons)\b/i.test(value);
  return queryMatches * 3 + (topicMatch ? 2 : 0) + (explainsWhy ? 6 : 0);
}

function bestEvidence(
  visit: SelectedClinicalVisit,
  message: string,
  category: string,
): string | null {
  const candidates = [...visit.documentedPlan, ...visit.providerStatements];
  const priorityPatterns = [
    /\brestart|treatment gap/i.test(message) ? /restart titration|treatment gap/i : null,
    /\b(?:government id|identification|identity|prescri)/i.test(message)
      ? /hold pending|government (?:photo )?id|identification|can'?t write a prescription/i
      : null,
    /\b(?:increase|take more)/i.test(message) ? /rather than increasing|do not simply titrate/i : null,
    /\b(?:45|dose|mg|titrat)/i.test(message)
      ? /titration to 45|comfortable with the protocol taking you to 45/i
      : null,
    /\b(?:denied|deny|declined|approve|right treatment)/i.test(message)
      ? /\b(?:why|reason)\b/i.test(message)
        ? /two reasons|because|reason/i
        : /not the right treatment|not approved|two reasons/i
      : null,
  ].filter((pattern): pattern is RegExp => Boolean(pattern));

  for (const pattern of priorityPatterns) {
    const match = candidates.find((value) => pattern.test(value));
    if (match) return match;
  }

  return candidates
    .map((value) => ({ value, score: evidenceScore(value, message, category) }))
    .sort((a, b) => b.score - a.score)[0]?.value ?? null;
}

export function applyClinicalContext(
  context: Tier1PatientContext,
  message: string,
  baseline: AssistantAnswer,
): AssistantAnswer {
  if (["crisis", "urgent_medical", "third_party_safety"].includes(baseline.category)) {
    return baseline;
  }

  const selected = selectRelevantClinicalContext(context.clinical, message, baseline.category);
  const visit = selected.visits[0];
  if (!visit) return baseline;

  const evidence = bestEvidence(visit, message, baseline.category);
  if (!evidence) return baseline;
  const punctuatedEvidence = /[.!?]$/.test(evidence) ? evidence : `${evidence}.`;

  return {
    ...baseline,
    answer:
      `${baseline.answer} The filtered clinical record from your ${formatDate(visit.date)} visit says: ${punctuatedEvidence} ` +
      "That explains the recorded plan at that visit; it is not a new diagnosis or medication instruction from this assistant.",
    facts: [
      ...baseline.facts,
      {
        label: "Clinical context",
        value: `${formatDate(visit.date)} visit`,
      },
    ],
    sources: [...new Set([...baseline.sources, ...selected.sources])],
  };
}
