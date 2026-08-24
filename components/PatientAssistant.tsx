"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import type {
  AnswerFact,
  AnswerTone,
  AssistantAnswer,
  Handoff,
  PatientId,
  PatientListItem,
  ReviewFlag,
} from "@/lib/domain/types";
import type { GenerationMetadata } from "@/lib/assistant/openaiResponseGenerator";

interface ChatMessage {
  id: string;
  role: "assistant" | "patient";
  text: string;
  tone?: AnswerTone;
  facts?: AnswerFact[];
  sources?: string[];
  handoff?: Handoff;
  generation?: GenerationMetadata;
  review?: ReviewFlag;
}

interface ChatApiResponse extends AssistantAnswer {
  patientId: PatientId;
  asOfDate: string;
  generation: GenerationMetadata;
}

const patientSuggestions: Record<PatientId, string[]> = {
  P1042: ["Where is my refill?", "What dose am I taking?", "Do I need another visit?"],
  P1108: ["When will my medication ship?", "Am I approved?", "Am I being charged?"],
  P1203: ["Why haven’t I received anything when I was charged?", "What is blocking my treatment?", "What form is missing?"],
  P1266: ["This isn’t working. Can I take more?", "How are my scores trending?", "What side effects are recorded?"],
  P1319: ["Can I restart at my old 60 mg dose?", "When is my returning visit?", "What is my account status?"],
};

const statusClass: Record<PatientListItem["status"], string> = {
  active: "status-active",
  onboarding: "status-onboarding",
  not_approved: "status-not-approved",
  churned: "status-churned",
};

const shipmentLabels: Record<string, string> = {
  AC: "Accepted",
  IT: "In transit",
  DE: "Delivered",
  AT: "Attempted",
  EX: "Exception",
  NY: "Not yet tracked",
  SP: "Held",
};

function makeWelcome(patient: PatientListItem): ChatMessage {
  return {
    id: `welcome-${patient.uid}`,
    role: "assistant",
    text: `Hi ${patient.firstName}. I can help you understand your current treatment record, relevant prior conversations, and documented provider plans. What would you like to know?`,
    facts: [
      { label: "Account status", value: patient.statusLabel },
      { label: "Records as of", value: "August 19, 2026" },
    ],
    sources: ["Tier 1 core records", "Tier 2 conversation memory", "Filtered Tier 3 clinical context"],
    tone: patient.attentionCount > 0 ? "attention" : "neutral",
  };
}

function displayAppointment(value: string | null): string {
  if (!value) return "None scheduled";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function AssistantMark() {
  return (
    <span className="assistant-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function generationLabel(generation: GenerationMetadata): string {
  const contextParts = [
    generation.memoryThreadsUsed
      ? `${generation.memoryThreadsUsed} memory thread${generation.memoryThreadsUsed === 1 ? "" : "s"}`
      : null,
    generation.clinicalNotesUsed
      ? `${generation.clinicalNotesUsed} clinical note${generation.clinicalNotesUsed === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);
  const suffix = contextParts.length ? ` · ${contextParts.join(" · ")}` : "";

  if (generation.mode === "openai") {
    return `${generation.model} · OpenAI grounded response${suffix}`;
  }
  if (generation.mode === "guarded") return `Deterministic safety response${suffix}`;
  return `Grounded fallback · OpenAI unavailable${suffix}`;
}

export function PatientAssistant({ patients }: { patients: PatientListItem[] }) {
  const [selectedId, setSelectedId] = useState<PatientId>(patients[0].uid);
  const patient = useMemo(
    () => patients.find((item) => item.uid === selectedId) ?? patients[0],
    [patients, selectedId],
  );
  const [messages, setMessages] = useState<ChatMessage[]>([makeWelcome(patient)]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setIsLoading(false);
    setMessages([makeWelcome(patient)]);
    setInput("");
  }, [patient]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const patientMessage: ChatMessage = {
      id: `patient-${Date.now()}`,
      role: "patient",
      text: trimmed,
    };
    setMessages((current) => [...current, patientMessage]);
    setInput("");
    setIsLoading(true);
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: selectedId,
          message: trimmed,
          history: messages.slice(-8).map((message) => ({
            role: message.role,
            text: message.text,
          })),
        }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as ChatApiResponse | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "The assistant could not respond.");
      }

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: payload.answer,
          tone: payload.tone,
          facts: payload.facts,
          sources: payload.sources,
          handoff: payload.handoff,
          generation: payload.generation,
          review: payload.review,
        },
      ]);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          text:
            error instanceof Error
              ? error.message
              : "I couldn’t read your patient records. No action was taken.",
          tone: "attention",
        },
      ]);
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setIsLoading(false);
      }
    }
  }

  function clearChat() {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setIsLoading(false);
    setMessages([makeWelcome(patient)]);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <main className="app-shell">
      <a className="skip-link" href="#patient-chat">Skip to conversation</a>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">J</div>
          <div>
            <p className="brand-name">joyous</p>
            <p className="brand-subtitle">Patient assistant</p>
          </div>
        </div>
        <div className="topbar-actions">
          <nav aria-label="Workspace navigation">
            <a className="insights-link" href="/product-insights">Product insights <span aria-hidden="true">↗</span></a>
          </nav>
          <div className="tier-badge"><span /> Tier 3 · Clinical</div>
        </div>
      </header>

      <section className="workspace">
        <aside className="patient-panel" aria-label="Demo patients">
          <div className="panel-heading">
            <p className="eyebrow">Demo workspace</p>
            <h1>Patient records</h1>
            <p>Choose a synthetic patient to test current records and prior conversation continuity.</p>
            <span className="record-count">{patients.length} synthetic records</span>
          </div>

          <div className="patient-list">
            {patients.map((item) => (
              <button
                className={`patient-option ${item.uid === selectedId ? "selected" : ""}`}
                key={item.uid}
                onClick={() => setSelectedId(item.uid)}
                type="button"
              >
                <span className="patient-avatar">{item.firstName.slice(0, 1)}</span>
                <span className="patient-option-copy">
                  <span className="patient-name-row">
                    <strong>{item.firstName}</strong>
                    {item.attentionCount > 0 && <span className="attention-count">{item.attentionCount}</span>}
                  </span>
                  <span>{item.uid}</span>
                </span>
                <span className={`status-dot ${statusClass[item.status]}`} />
              </button>
            ))}
          </div>

          <div className="scope-card">
            <div className="scope-icon" aria-hidden="true">✓</div>
            <div>
              <strong>Core + memory + clinical</strong>
              <p>Current records, relevant conversations, and filtered provider plans.</p>
            </div>
          </div>
        </aside>

        <section className="chat-panel" id="patient-chat" aria-labelledby="patient-chat-title">
          <div className="chat-header">
            <div>
              <p className="eyebrow">Patient conversation</p>
              <div className="patient-title-row">
                <h2 id="patient-chat-title">{patient.firstName}</h2>
                <span className={`status-pill ${statusClass[patient.status]}`}>{patient.statusLabel}</span>
              </div>
              <p className="chat-context-label">Grounded in current records, relevant memory, and filtered clinical context</p>
            </div>
            <button
              className="new-chat-button"
              type="button"
              onClick={clearChat}
            >
              <span aria-hidden="true">↻</span> New chat
            </button>
          </div>

          <div className="messages" aria-live="polite" aria-busy={isLoading}>
            {messages.map((message) => (
              <article className={`message-row ${message.role}`} key={message.id}>
                {message.role === "assistant" && <AssistantMark />}
                <div className={`message-bubble ${message.tone ? `tone-${message.tone}` : ""}`}>
                  <p className="message-text">{message.text}</p>

                  {message.facts && message.facts.length > 0 && (
                    <div className="fact-grid">
                      {message.facts.map((fact) => (
                        <div className={`fact ${fact.tone ? `fact-${fact.tone}` : ""}`} key={`${message.id}-${fact.label}`}>
                          <span>{fact.label}</span>
                          <strong>{fact.value}</strong>
                        </div>
                      ))}
                    </div>
                  )}

                  {message.handoff && (
                    <div className="handoff-card">
                      <span className="handoff-symbol" aria-hidden="true">↗</span>
                      <div>
                        <strong>{message.handoff.team} needed</strong>
                        <p>{message.handoff.reason}</p>
                        <small>Not sent — this prototype has no messaging integration.</small>
                      </div>
                    </div>
                  )}

                  {message.review && (
                    <div className="review-flag">
                      <span aria-hidden="true">✓</span>
                      <div>
                        <strong>Flagged for safety review</strong>
                        <p>Third-party concern — not classified as the patient’s own crisis.</p>
                        <small>Logged in this prototype; no message or notification was sent.</small>
                      </div>
                    </div>
                  )}

                  {message.sources && message.sources.length > 0 && (
                    <details className="sources">
                      <summary>Sources used · {message.sources.length}</summary>
                      <div className="source-list">
                        {message.sources.map((item) => <code key={item}>{item}</code>)}
                      </div>
                    </details>
                  )}

                  {message.generation && (
                    <div className={`generation-stamp generation-${message.generation.mode}`}>
                      <span aria-hidden="true" />
                      {generationLabel(message.generation)}
                    </div>
                  )}
                </div>
              </article>
            ))}

            {isLoading && (
              <div className="message-row assistant">
                <AssistantMark />
                <div className="typing-bubble" aria-label="Assistant is checking current records and conversation memory">
                  <span /><span /><span />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="composer-area">
            <div className="suggestions" aria-label="Suggested questions">
              {patientSuggestions[selectedId].map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => void sendMessage(suggestion)} disabled={isLoading}>
                  {suggestion}<span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
            <form className="composer" onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="patient-message">Ask about your treatment</label>
              <textarea
                id="patient-message"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Ask about your treatment, tasks, or account…"
                aria-describedby="patient-safety-note"
                rows={1}
                maxLength={1200}
              />
              <button type="submit" disabled={!input.trim() || isLoading} aria-label="Send message">
                <span aria-hidden="true">↑</span>
              </button>
            </form>
            <p className="composer-note" id="patient-safety-note">Not for emergencies or medical decisions. In immediate danger, call 911.</p>
          </div>
        </section>

        <aside className="snapshot-panel" aria-label={`${patient.firstName}'s Tier 3 snapshot`}>
          <div className="snapshot-heading">
            <p className="eyebrow">At a glance</p>
            <h2>Patient snapshot</h2>
            <span>As of Aug 19, 2026</span>
          </div>

          <div className="snapshot-cards">
            <div className="snapshot-card">
              <span className="snapshot-label">Treatment</span>
              <strong>{patient.statusLabel}</strong>
              <small>{patient.dose !== null && patient.status === "active" ? `${patient.dose} mg recorded dose` : "No active dose shown"}</small>
            </div>
            <div className="snapshot-card">
              <span className="snapshot-label">Check-ins</span>
              <strong>{patient.cadence ?? "Not started"}</strong>
              <small>{patient.cadence ? "Current protocol cadence" : "No cadence recorded"}</small>
            </div>
            <div className="snapshot-card">
              <span className="snapshot-label">Next visit</span>
              <strong>{displayAppointment(patient.nextMeeting)}</strong>
              <small>{patient.nextMeeting ? "See chat for local time" : "No upcoming visit found"}</small>
            </div>
            <div className={`snapshot-card ${patient.shipmentCode === "EX" ? "snapshot-alert" : ""}`}>
              <span className="snapshot-label">Latest shipment</span>
              <strong>{patient.shipmentCode ? shipmentLabels[patient.shipmentCode] ?? patient.shipmentCode : "No shipment"}</strong>
              <small>{patient.shipmentCode ? "Latest carrier status" : "No order found"}</small>
            </div>
            <div className={`snapshot-card ${patient.unresolvedMemoryCount > 0 ? "snapshot-alert" : ""}`}>
              <span className="snapshot-label">Conversation memory</span>
              <strong>{patient.memoryThreadCount} thread{patient.memoryThreadCount === 1 ? "" : "s"}</strong>
              <small>{patient.unresolvedMemoryCount} unresolved request{patient.unresolvedMemoryCount === 1 ? "" : "s"}</small>
            </div>
            <div className="snapshot-card">
              <span className="snapshot-label">Clinical context</span>
              <strong>{patient.clinicalVisitCount} visit note{patient.clinicalVisitCount === 1 ? "" : "s"}</strong>
              <small>Filtered provider statements and plans</small>
            </div>
          </div>

          {patient.attentionCount > 0 && (
            <div className="attention-card">
              <span>{patient.attentionCount}</span>
              <div>
                <strong>Open item{patient.attentionCount === 1 ? "" : "s"}</strong>
                <p>Ask “What do I need to do next?” for a grounded summary.</p>
              </div>
            </div>
          )}

          <div className="privacy-note">
            <strong>Data boundary</strong>
            <p>Changing patients clears this chat. All tiers are isolated by patient; raw transcripts, clinical summaries, and internal note comments are never sent to the model.</p>
          </div>
        </aside>
      </section>
    </main>
  );
}
