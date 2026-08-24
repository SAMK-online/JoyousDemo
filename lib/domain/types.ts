export const PATIENT_IDS = ["P1042", "P1108", "P1203", "P1266", "P1319"] as const;

export type PatientId = (typeof PATIENT_IDS)[number];

export type PatientLifecycleStatus = "active" | "onboarding" | "not_approved" | "churned";

export interface PatientProtocol {
  dose?: string;
  strength?: string;
  maxdose?: string;
  start_date?: string;
  doses_taken?: string;
  days_since_change?: string;
  discoverydone?: string;
  protocol?: string;
  checkin?: string;
  split_dose?: string | null;
  initial_phq?: string;
  initial_gad?: string;
  latestphq?: string;
  latestgad?: string;
  current_suicidality?: string | null;
  hold_prescription?: boolean;
  troches?: string;
  datetrochecount?: string;
  send_refill?: boolean;
  send_refill_date?: string;
  stopdate?: string;
  [key: string]: unknown;
}

export interface PatientFile {
  uid: PatientId;
  first_name: string;
  status: PatientLifecycleStatus;
  profile: {
    state: string;
    timezone: string;
    created_at: string;
    commitment_type: string | null;
  };
  protocol: PatientProtocol | null;
}

export interface PatientCase {
  case_id: string;
  case_type: string;
  case_group: string;
  status: string;
  next_action?: string | null;
  opened_at: string;
  closed_at?: string | null;
  requirement?: string;
  requirement_received?: boolean;
  risk?: string;
  imminent_suicidality?: boolean;
  follow_up_needed?: boolean;
  safety_plan_done?: boolean;
  severity?: string;
  sub_type?: string;
  current_dose?: string;
  meeting_ref?: string;
  check_list?: {
    active_subscription?: boolean;
    valid_prescription?: boolean;
    refills_remaining?: number;
    days_since_last_shipment?: number;
  };
  charges?: Array<{
    date: string;
    amount_usd: number;
    description: string;
  }>;
  [key: string]: unknown;
}

export interface CasesFile {
  uid: PatientId;
  cases: PatientCase[];
}

export interface Prescription {
  strength: number;
  type_of_prescription: string;
  number_of_refills: number;
  confirmation: boolean;
}

export interface Meeting {
  meeting_id: string;
  type: string;
  status: string;
  custom_status?: string | null;
  scheduled_at: string;
  duration: number;
  provider: string;
  assigned_nurse?: string | null;
  prescription: Prescription | null;
  note_ref?: string | null;
  [key: string]: unknown;
}

export interface MeetingsFile {
  uid: PatientId;
  meetings: Meeting[];
}

export interface TrackingEvent {
  occurredAt: string;
  eventCode: string;
  description: string;
  cityLocality?: string;
  stateProvince?: string;
}

export interface Shipment {
  order_number: string;
  is_refill: boolean;
  shipDate: string;
  trackingNumber: string;
  pt_confirmed_delivery: boolean;
  status: string;
  shipTo: {
    city: string;
    state: string;
    postalCode: string;
  };
  tracking: {
    statusCode: string;
    estimatedDeliveryDate: string | null;
    actualDeliveryDate: string | null;
    events: TrackingEvent[];
  };
}

export interface ShipmentsFile {
  uid: PatientId;
  orders: Shipment[];
}

export interface ScorePoint {
  value: number | string;
  source?: string;
  reported_on: string;
}

export interface DoseFeedback {
  date_reported: string;
  dose_pt_reported_taking?: string;
  dose_recommended?: string;
  dose_feels_right?: string;
  side_effects?: string[];
  notices_improvement?: string;
  split_dose?: string;
  [key: string]: unknown;
}

export interface CheckinsFile {
  uid: PatientId;
  cadence: string | null;
  checkins_count: number;
  history: Array<{
    date: string;
    type: string;
    form_id: string;
    duration_mins: number;
  }>;
  scores: {
    phq?: ScorePoint[];
    gad?: ScorePoint[];
    feel_today?: ScorePoint[];
    cssr?: ScorePoint[];
  };
  recent_dose_feedback?: DoseFeedback[];
  dose_changelog?: Array<Record<string, unknown>>;
}

export interface PatientForm {
  flow_label: string;
  uid: PatientId;
  finalized: boolean;
  submitted_at: string;
  answers: Record<string, unknown>;
  sourceFile: string;
}

export interface KnowledgeArticle {
  article_id: string;
  title: string;
  audience: string;
  updated_at: string;
  body: string[];
  sourceFile: string;
}

export interface RawTier1Record {
  patient: PatientFile;
  cases: CasesFile;
  meetings: MeetingsFile;
  shipments: ShipmentsFile;
  checkins: CheckinsFile;
  forms: PatientForm[];
  knowledgeBase: KnowledgeArticle[];
}

export type ConversationSender =
  | "patient"
  | "ai_assistant"
  | "care_team"
  | "nurse_team"
  | "system_automated";

export interface ConversationMessage {
  sent_at: string;
  from: ConversationSender;
  text: string;
}

export interface ConversationThread {
  thread_id: string;
  opened_at: string;
  channel: "sms" | "app_message";
  status: "open" | "resolved" | "no_reply";
  escalated_to: "care_team" | "nurse_team" | null;
  tags: string[];
  messages: ConversationMessage[];
  unresolved_request?: string;
  review_flag?: string;
}

export interface ConversationsFile {
  uid: PatientId;
  threads: ConversationThread[];
}

export interface NormalizedConversationMessage extends ConversationMessage {
  internal: boolean;
}

export interface NormalizedConversationThread extends Omit<ConversationThread, "messages"> {
  messages: NormalizedConversationMessage[];
  latestMessageAt: string;
  latestPatientMessageAt: string | null;
  hasStaffReplyAfterLatestPatientMessage: boolean;
}

export interface PatientMemoryContext {
  threads: NormalizedConversationThread[];
  openThreads: NormalizedConversationThread[];
  unresolvedThreads: NormalizedConversationThread[];
}

export interface VisitTranscriptLine {
  speaker: string;
  text: string;
}

export interface VisitNote {
  note_id: string;
  meeting_id: string;
  date: string;
  meeting_type: string;
  participants: string[];
  transcript: VisitTranscriptLine[];
  clinical_summary: string;
  plan: string;
}

export interface VisitNotesFile {
  uid: PatientId;
  notes: VisitNote[];
}

export interface ClinicalVisitContext {
  noteId: string;
  meetingId: string;
  date: string;
  meetingType: string;
  providerStatements: string[];
  documentedPlan: string[];
  topics: string[];
  redactedInternalLineCount: number;
}

export interface PatientClinicalContext {
  visits: ClinicalVisitContext[];
}

export type TrendDirection = "improving" | "worsening" | "unchanged" | "unavailable";

export interface TrendSummary {
  initial: number | null;
  latest: number | null;
  change: number | null;
  direction: TrendDirection;
}

export interface Tier1PatientContext {
  asOfDate: string;
  patient: PatientFile;
  protocolIsHistorical: boolean;
  allCases: PatientCase[];
  openCases: PatientCase[];
  actionableCases: PatientCase[];
  latestMeeting: Meeting | null;
  upcomingMeetings: Meeting[];
  latestShipment: Shipment | null;
  activeShipmentException: Shipment | null;
  phqTrend: TrendSummary;
  gadTrend: TrendSummary;
  checkinCount: number;
  recentMood: number | null;
  recentSideEffects: string[];
  safetyCase: PatientCase | null;
  forms: PatientForm[];
  knowledgeBase: KnowledgeArticle[];
  memory?: PatientMemoryContext;
  clinical?: PatientClinicalContext;
}

export interface PatientListItem {
  uid: PatientId;
  firstName: string;
  status: PatientLifecycleStatus;
  statusLabel: string;
  dose: number | null;
  cadence: string | null;
  nextMeeting: string | null;
  shipmentCode: string | null;
  attentionCount: number;
  memoryThreadCount: number;
  unresolvedMemoryCount: number;
  clinicalVisitCount: number;
}

export type AnswerTone = "neutral" | "attention" | "urgent" | "positive";

export interface AnswerFact {
  label: string;
  value: string;
  tone?: AnswerTone;
}

export interface Handoff {
  required: boolean;
  team: "Care Team" | "Nurse Team" | "Provider";
  reason: string;
  sent: false;
}

export interface ReviewFlag {
  required: true;
  reason: "third_party_suicide_loss" | "third_party_suicide_risk";
  logged: true;
  sent: false;
}

export interface AssistantAnswer {
  answer: string;
  category: string;
  tone: AnswerTone;
  facts: AnswerFact[];
  sources: string[];
  handoff?: Handoff;
  review?: ReviewFlag;
}
