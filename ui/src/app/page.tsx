"use client";

import { FormEvent, useMemo, useState } from "react";
import styles from "./page.module.css";
import {
  ApiError,
  TenantResponse,
  TriageResponse,
  createTenant,
  getApiBaseUrl,
  sendTriage,
} from "@/lib/api";

type ConversationEntry = {
  role: "caller" | "assistant" | "system";
  content: string;
  timestamp: string;
};

const defaultInstructions =
  "Greet callers with a warm \"Thanks for calling Demo HVAC, this is your dispatcher\" intro. Collect contact info, classify the issue, and reassure them we handle everything. Be transparent about our $99 diagnostic/service fee and let callers know it is credited toward repairs if they approve work within 24 hours. Always look for tasteful upsell moments (maintenance plans, priority booking) after understanding their problem. Close with a concise summary of what will happen next.";

const availableTools = [
  { id: "create_job", label: "Create job" },
  { id: "request_more_info", label: "Request more info" },
  { id: "mark_emergency", label: "Mark emergency" },
  { id: "lookup_price_range", label: "Lookup price range" },
  { id: "update_customer_profile", label: "Update customer profile" },
];

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

export default function Home() {
  const apiBase = useMemo(() => getApiBaseUrl(), []);

  const [tenantForm, setTenantForm] = useState({
    name: "demo_hvac",
    displayName: "Demo HVAC Contractor",
    instructions: defaultInstructions,
    adminToken: "",
    allowedTools: availableTools.map((tool) => tool.id),
  });
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantError, setTenantError] = useState<string | null>(null);
  const [tenantResult, setTenantResult] = useState<TenantResponse | null>(null);

  const [triageForm, setTriageForm] = useState({
    tenantId: "",
    sessionId: "caller-",
    message: "",
  });
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [lastResponse, setLastResponse] = useState<TriageResponse | null>(null);

  const lastJob = useMemo(() => {
    if (
      lastResponse &&
      typeof lastResponse === "object" &&
      "status" in lastResponse &&
      lastResponse.status === "job_created"
    ) {
      return lastResponse.job;
    }
    return null;
  }, [lastResponse]);

  const addConversationEntry = (entry: ConversationEntry) => {
    setConversation((prev) => [...prev, entry]);
  };

  const toggleAllowedTool = (toolId: string) => {
    setTenantForm((prev) => {
      const set = new Set(prev.allowedTools);
      if (set.has(toolId)) {
        set.delete(toolId);
      } else {
        set.add(toolId);
      }
      return { ...prev, allowedTools: Array.from(set) };
    });
  };

  const handleTenantSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tenantForm.adminToken.trim()) {
      setTenantError("Admin token is required.");
      return;
    }

    setTenantLoading(true);
    setTenantError(null);

    try {
      const response = await createTenant(tenantForm);
      setTenantResult(response);
      addConversationEntry({
        role: "system",
        content: `Tenant created: ${response.displayName} (${response.tenantId})`,
        timestamp: new Date().toLocaleTimeString(),
      });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? `${error.status}: ${error.message}`
          : "Unable to create tenant.";
      setTenantError(message);
    } finally {
      setTenantLoading(false);
    }
  };

  const handleTriageSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!triageForm.tenantId.trim()) {
      setTriageError("Tenant ID is required.");
      return;
    }

    if (!triageForm.message.trim()) {
      setTriageError("Please enter a message.");
      return;
    }

    setTriageLoading(true);
    setTriageError(null);
    const timestamp = new Date().toLocaleTimeString();

    addConversationEntry({
      role: "caller",
      content: triageForm.message.trim(),
      timestamp,
    });

    try {
      const response = await sendTriage(triageForm);
      setLastResponse(response);
      addConversationEntry({
        role: "assistant",
        content: formatAssistantResponse(response),
        timestamp: new Date().toLocaleTimeString(),
      });
      setTriageForm((prev) => ({ ...prev, message: "" }));
    } catch (error) {
      const message =
        error instanceof ApiError
          ? `${error.status}: ${error.message}`
          : "Triage request failed.";
      setTriageError(message);
      addConversationEntry({
        role: "assistant",
        content: `Error: ${message}`,
        timestamp: new Date().toLocaleTimeString(),
      });
    } finally {
      setTriageLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Signmons CallDesk Sandbox</h1>
          <p>
            Requests are pointed at <code>{apiBase}</code>. Supply your admin
            token manually so it never lives in source control.
          </p>
        </div>
      </header>

      <main className={styles.grid}>
        <section className={styles.card}>
          <header>
            <h2>Onboard a tenant</h2>
            <p>
              Create tenants securely by posting to{" "}
              <code>/tenants</code> with a one-time token.
            </p>
          </header>

          <form className={styles.form} onSubmit={handleTenantSubmit}>
            <label className={styles.label}>
              Tenant slug
              <input
                className={styles.input}
                name="name"
                value={tenantForm.name}
                onChange={(event) =>
                  setTenantForm((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                autoComplete="off"
                placeholder="demo_hvac"
                required
              />
            </label>

            <label className={styles.label}>
              Display name
              <input
                className={styles.input}
                name="displayName"
                value={tenantForm.displayName}
                onChange={(event) =>
                  setTenantForm((prev) => ({
                    ...prev,
                    displayName: event.target.value,
                  }))
                }
                autoComplete="off"
                placeholder="Demo HVAC Contractor"
                required
              />
            </label>

            <label className={styles.label}>
              AI instructions
              <textarea
                className={styles.textarea}
                name="instructions"
                value={tenantForm.instructions}
                onChange={(event) =>
                  setTenantForm((prev) => ({
                    ...prev,
                    instructions: event.target.value,
                  }))
                }
                rows={4}
                required
              />
            </label>

            <div className={styles.fieldset}>
              <p className={styles.label}>Allowed AI tools</p>
              <div className={styles.checkboxGrid}>
                {availableTools.map((tool) => (
                  <label key={tool.id} className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={tenantForm.allowedTools.includes(tool.id)}
                      onChange={() => toggleAllowedTool(tool.id)}
                    />
                    <span>{tool.label}</span>
                  </label>
                ))}
              </div>
              <p className={styles.hint}>
                Uncheck any tools you are not ready to enable for this tenant.
              </p>
            </div>

            <label className={styles.label}>
              Admin token
              <input
                className={styles.input}
                name="adminToken"
                type="password"
                value={tenantForm.adminToken}
                onChange={(event) =>
                  setTenantForm((prev) => ({
                    ...prev,
                    adminToken: event.target.value,
                  }))
                }
                autoComplete="off"
                placeholder="Enter token at runtime"
                required
              />
            </label>

            <p className={styles.hint}>
              Tokens are never stored—refresh the page when you are done.
            </p>

            <button
              className={styles.button}
              type="submit"
              disabled={tenantLoading}
            >
              {tenantLoading ? "Creating…" : "Create tenant"}
            </button>

            {tenantError && (
              <p role="alert" className={styles.error}>
                {tenantError}
              </p>
            )}

            {tenantResult && (
              <div className={styles.success}>
                <p>Tenant onboarded.</p>
                <ul>
                  <li>
                    <strong>ID:</strong> {tenantResult.tenantId}
                  </li>
                  <li>
                    <strong>Display:</strong> {tenantResult.displayName}
                  </li>
                  {tenantResult.allowedTools?.length ? (
                    <li>
                      <strong>Tools:</strong>{" "}
                      {tenantResult.allowedTools.join(", ")}
                    </li>
                  ) : null}
                </ul>
              </div>
            )}
          </form>
        </section>

        <section className={styles.card}>
          <header>
            <h2>AI triage</h2>
            <p>
              Simulate the caller experience. Provide a tenant ID, session ID,
              and the caller&apos;s latest message.
            </p>
          </header>

          <form className={styles.form} onSubmit={handleTriageSubmit}>
            <label className={styles.label}>
              Tenant ID
              <input
                className={styles.input}
                name="tenantId"
                value={triageForm.tenantId}
                onChange={(event) =>
                  setTriageForm((prev) => ({
                    ...prev,
                    tenantId: event.target.value,
                  }))
                }
                required
              />
            </label>

            <label className={styles.label}>
              Session ID
              <input
                className={styles.input}
                name="sessionId"
                value={triageForm.sessionId}
                onChange={(event) =>
                  setTriageForm((prev) => ({
                    ...prev,
                    sessionId: event.target.value,
                  }))
                }
                required
              />
            </label>

            <label className={styles.label}>
              Caller message
              <textarea
                className={styles.textarea}
                name="message"
                value={triageForm.message}
                onChange={(event) =>
                  setTriageForm((prev) => ({
                    ...prev,
                    message: event.target.value,
                  }))
                }
                rows={3}
                required
              />
            </label>

            <button
              className={styles.button}
              type="submit"
              disabled={triageLoading}
            >
              {triageLoading ? "Sending…" : "Send message"}
            </button>

            {triageError && (
              <p role="alert" className={styles.error}>
                {triageError}
              </p>
            )}
          </form>

          <div className={styles.timeline}>
            <h3>Conversation</h3>
            {conversation.length === 0 ? (
              <p className={styles.muted}>
                No messages yet. Submit the form above to populate the thread.
              </p>
            ) : (
              <ul className={styles.timelineList}>
                {conversation.map((entry, index) => (
                  <li key={`${entry.timestamp}-${index}`}>
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
