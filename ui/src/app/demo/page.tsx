"use client";

import { FormEvent, useMemo, useState } from "react";
import styles from "./page.module.css";
import { ApiError, TriageResponse, getApiBaseUrl, sendTriage } from "@/lib/api";

type ConversationEntry = {
  role: "caller" | "assistant" | "system";
  content: string;
  timestamp: string;
};

const demoTenantId = process.env.NEXT_PUBLIC_DEMO_TENANT_ID ?? "";

const formatAssistantResponse = (payload: TriageResponse): string => {
  if (payload && typeof payload === "object" && "status" in payload) {
    if (payload.status === "reply") {
      return payload.reply ?? "";
    }

    if (payload.status === "job_created") {
      const job = payload.job;
      return [
        payload.message ?? "Job created successfully.",
        job.customerName ? `Customer: ${job.customerName}` : null,
        job.issueCategory ? `Category: ${job.issueCategory}` : null,
        job.urgency ? `Urgency: ${job.urgency}` : null,
        job.id ? `Job ID: ${job.id}` : null,
      ]
        .filter(Boolean)
        .join(" • ");
    }
  }

  return JSON.stringify(payload);
};

const createSessionId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `caller-${crypto.randomUUID()}`;
  }
  return `caller-${Math.random().toString(36).slice(2, 10)}`;
};

export default function DemoPage() {
  const apiBase = useMemo(() => getApiBaseUrl(), []);
  const [sessionId] = useState(createSessionId);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [lastResponse, setLastResponse] = useState<TriageResponse | null>(null);

  const lastJob =
    lastResponse &&
    typeof lastResponse === "object" &&
    "status" in lastResponse &&
    lastResponse.status === "job_created"
      ? lastResponse.job
      : null;

  const addEntry = (entry: ConversationEntry) => {
    setConversation((prev) => [...prev, entry]);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!demoTenantId.trim()) {
      setError("Demo tenant ID is not configured.");
      return;
    }

    if (!message.trim()) {
      setError("Please enter a message.");
      return;
    }

    setLoading(true);
    setError(null);
    const timestamp = new Date().toLocaleTimeString();

    addEntry({
      role: "caller",
      content: message.trim(),
      timestamp,
    });

    try {
      const response = await sendTriage({
        tenantId: demoTenantId,
        sessionId,
        message: message.trim(),
      });
      setLastResponse(response);
      addEntry({
        role: "assistant",
        content: formatAssistantResponse(response),
        timestamp: new Date().toLocaleTimeString(),
      });
      setMessage("");
    } catch (err) {
      const messageText =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : "Triage request failed.";
      setError(messageText);
      addEntry({
        role: "assistant",
        content: `Error: ${messageText}`,
        timestamp: new Date().toLocaleTimeString(),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Caller Demo</p>
          <h1>Signmons CallDesk</h1>
          <p className={styles.subhead}>
            No tokens, no onboarding. Just simulate a caller and watch the AI
            dispatch flow in real time.
          </p>
        </div>
        <div className={styles.headerBadge}>
          <span className={styles.pill}>Live Demo</span>
          <span className={styles.subtitle}>API: {apiBase}</span>
        </div>
      </header>

      <main className={styles.grid}>
        <section className={styles.card}>
          <header>
            <h2>Caller message</h2>
            <p className={styles.muted}>
              Session ID is auto-generated. Demo tenant is pre-wired in the
              environment.
            </p>
          </header>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.label}>
              Describe the issue
              <textarea
                className={styles.textarea}
                name="message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={4}
                placeholder="Example: Furnace is blowing cold air and it’s 50 degrees inside."
                required
              />
            </label>

            <button
              className={styles.button}
              type="submit"
              disabled={loading}
            >
              {loading ? "Sending…" : "Send message"}
            </button>

            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
          </form>
        </section>

        <section className={styles.card}>
          <header>
            <h2>Conversation</h2>
            <p className={styles.muted}>
              Real-time transcript of the AI intake flow.
            </p>
          </header>

          <div className={styles.timeline}>
            {conversation.length === 0 ? (
              <p className={styles.muted}>
                No messages yet. Send a caller message to begin.
              </p>
            ) : (
              <ul className={styles.timelineList}>
                {conversation.map((entry, index) => (
                  <li
                    key={`${entry.timestamp}-${index}`}
                    className={`${styles.timelineItem} ${styles[entry.role]}`}
                  >
                    <span className={styles.timelineMeta}>
                      {entry.timestamp} · {entry.role.toUpperCase()}
                    </span>
                    <p>{entry.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {lastJob && (
            <div className={styles.success}>
              <h3>Latest job</h3>
              <pre className={styles.codeBlock}>
                {JSON.stringify(lastJob, null, 2)}
              </pre>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
