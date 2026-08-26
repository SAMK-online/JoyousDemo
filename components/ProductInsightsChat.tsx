"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import type { ProductInsightAnswer } from "@/lib/insights/productInsightsAssistant";

type InsightsMessage = {
  id: string;
  role: "assistant" | "product";
  text: string;
  result?: ProductInsightAnswer;
};

type InsightsApiResponse = ProductInsightAnswer & { reportAsOf: string; sessionId: string };

const suggestions = [
  "Which gaps should we investigate first, and why?",
  "What underlying need connects the highest-priority themes?",
  "Where could Tier 1 fail even when a theme is marked covered?",
  "What should we measure before shipping a new capability?",
];

const welcome: InsightsMessage = {
  id: "insights-welcome",
  role: "assistant",
  text: "Ask me to compare themes, challenge a prioritization, or turn these signals into research hypotheses. I use only the de-identified aggregate report shown on this page.",
};

function generationLabel(result: ProductInsightAnswer) {
  if (result.generation.mode === "openai") {
    return `${result.generation.model} · aggregate report only`;
  }
  return "Deterministic aggregate analysis · model fallback";
}

export function ProductInsightsChat() {
  const [messages, setMessages] = useState<InsightsMessage[]>([welcome]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string>();
  const requestControllerRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMessage: InsightsMessage = {
      id: `product-${Date.now()}`,
      role: "product",
      text: trimmed,
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setIsLoading(true);

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;

    try {
      const response = await fetch("/api/product-insights/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: messages.slice(-8).map((message) => ({
            role: message.role,
            text: message.text,
          })),
          sessionId,
        }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as InsightsApiResponse | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "The insights copilot could not respond.");
      }

      setSessionId(payload.sessionId);

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: payload.answer,
          result: payload,
        },
      ]);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          text: error instanceof Error ? error.message : "The aggregate report could not be analyzed.",
        },
      ]);
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setIsLoading(false);
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function clearChat() {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setMessages([welcome]);
    setInput("");
    setIsLoading(false);
    setSessionId(undefined);
  }

  return (
    <section className="insights-copilot" aria-labelledby="insights-copilot-title">
      <div className="copilot-heading">
        <div>
          <p className="eyebrow">Product research copilot</p>
          <h2 id="insights-copilot-title">Interrogate the patterns</h2>
          <p>Explore hypotheses and trade-offs using the aggregate report—without sending raw transcripts to the model.</p>
        </div>
        <div className="copilot-heading-actions">
          <span><i /> Aggregate data only</span>
          <button type="button" onClick={clearChat}>New chat</button>
        </div>
      </div>

      <div className="copilot-layout">
        <div className="copilot-thread" aria-live="polite" aria-busy={isLoading}>
          {messages.map((message) => (
            <article className={`copilot-message ${message.role}`} key={message.id}>
              <div className="copilot-message-label">
                {message.role === "assistant" ? "Insights copilot" : "Product team"}
              </div>
              <div className="copilot-bubble">
                <p>{message.text}</p>

                {message.result && message.result.evidence.length > 0 && (
                  <div className="copilot-evidence">
                    <span>Evidence in this report</span>
                    {message.result.evidence.map((item) => (
                      <div key={`${message.id}-${item.themeId}`}>
                        <div>
                          <strong>{item.themeTitle}</strong>
                          <small className={`coverage coverage-${item.coverage}`}>{item.coverage}</small>
                        </div>
                        <p>{item.claim}</p>
                        <small>{item.patientCount} patient{item.patientCount === 1 ? "" : "s"} · {item.mentionCount} matched utterance{item.mentionCount === 1 ? "" : "s"}</small>
                      </div>
                    ))}
                  </div>
                )}

                {message.result && message.result.suggestedActions.length > 0 && (
                  <div className="copilot-actions">
                    <span>Suggested next moves</span>
                    <ul>
                      {message.result.suggestedActions.map((action) => <li key={action}>{action}</li>)}
                    </ul>
                  </div>
                )}

                {message.result && (
                  <div className="copilot-limitation">
                    <strong>Read with caution</strong>
                    <p>{message.result.limitation}</p>
                  </div>
                )}

                {message.result && (
                  <div className={`copilot-generation generation-${message.result.generation.mode}`}>
                    <i /> {generationLabel(message.result)}
                  </div>
                )}
              </div>
            </article>
          ))}

          {isLoading && (
            <div className="copilot-loading" aria-label="Analyzing aggregate insights">
              <span /><span /><span />
              <small>Comparing themes and coverage…</small>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="copilot-composer-area">
          <div className="copilot-suggestions" aria-label="Suggested product questions">
            {suggestions.map((suggestion) => (
              <button type="button" key={suggestion} onClick={() => void sendMessage(suggestion)} disabled={isLoading}>
                {suggestion}<span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
          <form className="copilot-composer" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="insights-message">Ask about product insights</label>
            <textarea
              id="insights-message"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Ask what these patterns imply, what is missing, or what to validate next…"
              aria-describedby="copilot-discovery-note"
              rows={3}
              maxLength={1200}
            />
            <div>
              <small>{input.length}/1200</small>
              <button type="submit" disabled={!input.trim() || isLoading}>Analyze <span aria-hidden="true">↑</span></button>
            </div>
          </form>
          <p className="copilot-note" id="copilot-discovery-note">Discovery aid only. Signals come from a small synthetic sample and require Product and Clinical review.</p>
        </div>
      </div>
    </section>
  );
}
