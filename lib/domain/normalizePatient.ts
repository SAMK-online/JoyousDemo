import type {
  PatientCase,
  ConversationsFile,
  PatientMemoryContext,
  PatientClinicalContext,
  PatientListItem,
  RawTier1Record,
  ScorePoint,
  Tier1PatientContext,
  TrendSummary,
  VisitNotesFile,
} from "./types.js";

export const EXERCISE_DATE = "2026-08-19";

const actionableCaseTypes = new Set([
  "suicidality",
  "hhh",
  "create_prescription",
  "refill",
  "medication_order",
  "side_effects",
  "payment",
]);

const actionPriority: Record<string, number> = {
  suicidality: 0,
  hhh: 1,
  medication_order: 2,
  refill: 3,
  create_prescription: 4,
  side_effects: 5,
  payment: 6,
};

function isOpen(patientCase: PatientCase): boolean {
  return patientCase.status.toLowerCase() === "open";
}

function numericScore(point: ScorePoint | undefined): number | null {
  if (!point) return null;
  const score = Number(point.value);
  return Number.isFinite(score) ? score : null;
}

function summarizeTrend(points: ScorePoint[] | undefined): TrendSummary {
  if (!points?.length) {
    return { initial: null, latest: null, change: null, direction: "unavailable" };
  }

  const sorted = [...points].sort((a, b) => a.reported_on.localeCompare(b.reported_on));
  const initial = numericScore(sorted[0]);
  const latest = numericScore(sorted.at(-1));

  if (initial === null || latest === null) {
    return { initial, latest, change: null, direction: "unavailable" };
  }

  const change = latest - initial;
  return {
    initial,
    latest,
    change,
    direction: change < 0 ? "improving" : change > 0 ? "worsening" : "unchanged",
  };
}

export function normalizePatientMemory(raw: ConversationsFile): PatientMemoryContext {
  const threads = raw.threads
    .map((thread) => {
      const messages = [...thread.messages]
        .sort((a, b) => a.sent_at.localeCompare(b.sent_at))
        .map((message) => ({
          ...message,
          internal: /^\s*\[internal\]/i.test(message.text),
        }));
      const latestPatientMessage = [...messages]
        .reverse()
        .find((message) => message.from === "patient");
      const latestPatientMessageAt = latestPatientMessage?.sent_at ?? null;
      const hasStaffReplyAfterLatestPatientMessage = Boolean(
        latestPatientMessageAt &&
          messages.some(
            (message) =>
              ["care_team", "nurse_team"].includes(message.from) &&
              message.sent_at > latestPatientMessageAt,
          ),
      );

      return {
        ...thread,
        messages,
        latestMessageAt: messages.at(-1)?.sent_at ?? thread.opened_at,
        latestPatientMessageAt,
        hasStaffReplyAfterLatestPatientMessage,
      };
    })
    .sort((a, b) => b.latestMessageAt.localeCompare(a.latestMessageAt));

  return {
    threads,
    openThreads: threads.filter((thread) => thread.status === "open"),
    unresolvedThreads: threads.filter((thread) => Boolean(thread.unresolved_request)),
  };
}

const nonPatientFacingPlanPatterns = [
  /under[- ]report|minimis/i,
  /unreliable at booking/i,
  /do not relitigate/i,
  /low technical confidence/i,
  /retention risk/i,
  /he was irritated/i,
  /if (?:he|she) contacts support/i,
];

const clinicalTopicPatterns: Record<string, RegExp> = {
  approval: /approv|appropriate|declin|not the right treatment/i,
  dose: /\bmg\b|dose|troche|titrat|restart/i,
  monitoring: /monitor|check[- ]?in|score|follow[- ]?up|blood pressure/i,
  safety: /suicid|self[- ]?harm|hurt(?:ing)? yourself|passive ideation/i,
  identity: /government id|identification|identity|name.*match/i,
  alcohol: /alcohol|drinking|pancreatitis|audit/i,
  sleep: /sleep|insomnia/i,
  refill: /refill|shipment|renew|prescription/i,
};

function planSentences(plan: string): string[] {
  return plan
    .split(/\.\s+/)
    .map((sentence) => sentence.trim().replace(/\.$/, ""))
    .filter(Boolean)
    .filter(
      (sentence) =>
        !nonPatientFacingPlanPatterns.some((pattern) => pattern.test(sentence)),
    );
}

function sanitizeProviderStatement(statement: string): string {
  return statement
    .replace(/I(?:'ve| have) read [A-Z][a-z]+'s notes/g, "I’ve reviewed the care team’s notes")
    .replace(/gone through everything with [A-Z][a-z]+/g, "reviewed everything with the care team");
}

export function normalizePatientClinicalNotes(
  raw: VisitNotesFile,
): PatientClinicalContext {
  const visits = raw.notes
    .map((note) => {
      const internalLines = note.transcript.filter((line) => /^\s*\[/.test(line.text));
      const providerStatements = note.transcript
        .filter((line) => line.speaker === "Provider" && !/^\s*\[/.test(line.text))
        .map((line) => sanitizeProviderStatement(line.text));
      const documentedPlan = planSentences(note.plan);
      const searchable = [...providerStatements, ...documentedPlan].join(" ");
      const topics = Object.entries(clinicalTopicPatterns)
        .filter(([, pattern]) => pattern.test(searchable))
        .map(([topic]) => topic);

      return {
        noteId: note.note_id,
        meetingId: note.meeting_id,
        date: note.date,
        meetingType: note.meeting_type,
        providerStatements,
        documentedPlan,
        topics,
        redactedInternalLineCount: internalLines.length,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return { visits };
}

export function normalizePatientRecord(
  raw: RawTier1Record,
  memory?: ConversationsFile,
  clinical?: VisitNotesFile,
): Tier1PatientContext {
  const openCases = raw.cases.cases.filter(isOpen);
  const meetings = [...raw.meetings.meetings].sort((a, b) =>
    a.scheduled_at.localeCompare(b.scheduled_at),
  );
  const orders = [...raw.shipments.orders].sort((a, b) => a.shipDate.localeCompare(b.shipDate));
  const moodPoints = [...(raw.checkins.scores.feel_today ?? [])].sort((a, b) =>
    a.reported_on.localeCompare(b.reported_on),
  );
  const latestFeedback = [...(raw.checkins.recent_dose_feedback ?? [])].sort((a, b) =>
    a.date_reported.localeCompare(b.date_reported),
  ).at(-1);

  return {
    asOfDate: EXERCISE_DATE,
    patient: raw.patient,
    protocolIsHistorical: raw.patient.status === "churned",
    allCases: raw.cases.cases,
    openCases,
    actionableCases: openCases
      .filter((patientCase) => actionableCaseTypes.has(patientCase.case_type))
      .sort((a, b) => (actionPriority[a.case_type] ?? 99) - (actionPriority[b.case_type] ?? 99)),
    latestMeeting: meetings.at(-1) ?? null,
    upcomingMeetings: meetings.filter((meeting) => meeting.scheduled_at.slice(0, 10) >= EXERCISE_DATE),
    latestShipment: orders.at(-1) ?? null,
    activeShipmentException:
      [...orders].reverse().find((order) => order.tracking.statusCode === "EX") ?? null,
    phqTrend: summarizeTrend(raw.checkins.scores.phq),
    gadTrend: summarizeTrend(raw.checkins.scores.gad),
    checkinCount: raw.checkins.checkins_count,
    recentMood: numericScore(moodPoints.at(-1)),
    recentSideEffects: latestFeedback?.side_effects ?? [],
    safetyCase:
      openCases.find((patientCase) => patientCase.case_type === "suicidality") ?? null,
    forms: raw.forms,
    knowledgeBase: raw.knowledgeBase,
    memory: memory ? normalizePatientMemory(memory) : undefined,
    clinical: clinical ? normalizePatientClinicalNotes(clinical) : undefined,
  };
}

const lifecycleLabels: Record<string, string> = {
  active: "Active treatment",
  onboarding: "Onboarding",
  not_approved: "Not approved",
  churned: "Past patient",
};

export function toPatientListItem(context: Tier1PatientContext): PatientListItem {
  const protocol = context.patient.protocol;
  return {
    uid: context.patient.uid,
    firstName: context.patient.first_name,
    status: context.patient.status,
    statusLabel: lifecycleLabels[context.patient.status] ?? context.patient.status,
    dose: protocol?.dose ? Number(protocol.dose) : null,
    cadence: protocol?.checkin ?? null,
    nextMeeting: context.upcomingMeetings[0]?.scheduled_at ?? null,
    shipmentCode: context.latestShipment?.tracking.statusCode ?? null,
    attentionCount: context.actionableCases.length,
    memoryThreadCount: context.memory?.threads.length ?? 0,
    unresolvedMemoryCount: context.memory?.unresolvedThreads.length ?? 0,
    clinicalVisitCount: context.clinical?.visits.length ?? 0,
  };
}
