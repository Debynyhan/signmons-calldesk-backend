"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import {
  ApiError,
  DevAuthConfig,
  RequestAuth,
  TenantResponse,
  TriageResponse,
  createTenant,
  getApiBaseUrl,
  sendTriage,
} from "@/lib/api";

type ConversationEntry = {
  id: string;
  role: "caller" | "assistant" | "system";
  content: string;
  timestamp: string;
};

const defaultInstructions =
  "Greet callers with a warm \"Thanks for calling Demo HVAC, this is your dispatcher\" intro. Collect contact info, classify the issue, and reassure them we handle everything. Be transparent about our $99 diagnostic/service fee and let callers know it is credited toward repairs if they approve work within 24 hours. Always look for tasteful upsell moments (maintenance plans, priority booking) after understanding their problem. Close with a concise summary of what will happen next.";

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
        .join(" | ");
    }
  }

  return JSON.stringify(payload);
};

const makeEntry = (role: ConversationEntry["role"], content: string) => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  role,
  content,
  timestamp: new Date().toLocaleTimeString(),
});

const defaultDevAuth: DevAuthConfig = {
  secret: process.env.NEXT_PUBLIC_DEV_AUTH_SECRET ?? "",
  role: process.env.NEXT_PUBLIC_DEV_AUTH_ROLE ?? "admin",
  userId: process.env.NEXT_PUBLIC_DEV_AUTH_USER_ID ?? "dev-admin",
  tenantId: "",
};

type AuthMode = "dev" | "admin";

export default function Home() {
  const apiBase = useMemo(() => getApiBaseUrl(), []);
  const endRef = useRef<HTMLDivElement | null>(null);

  const [authMode, setAuthMode] = useState<AuthMode>("dev");
  const [devAuth, setDevAuth] = useState<DevAuthConfig>(defaultDevAuth);
  const [adminToken, setAdminToken] = useState("");

  const [tenantForm, setTenantForm] = useState({
    name: "demo_hvac",
    displayName: "Demo HVAC Contractor",
    instructions: defaultInstructions,
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

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.length]);

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

  const buildAuth = (): RequestAuth => {
    if (authMode === "admin") {
      return { adminToken };
    }

    return { devAuth };
  };

  const addConversationEntry = (entry: ConversationEntry) => {
    setConversation((prev) => [...prev, entry]);
  };

  const handleTenantSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (authMode === "admin" && !adminToken.trim()) {
      setTenantError("Admin token is required.");
      return;
    }

    if (authMode === "dev" && !devAuth.secret?.trim()) {
      setTenantError("Dev auth secret is required.");
      return;
    }

    setTenantLoading(true);
    setTenantError(null);

    try {
      const response = await createTenant(tenantForm, buildAuth());
      setTenantResult(response);
      setTriageForm((prev) => ({ ...prev, tenantId: response.tenantId }));
      setDevAuth((prev) => ({ ...prev, tenantId: response.tenantId }));
      addConversationEntry(
        makeEntry(
          "system",
          `Tenant created: ${response.displayName} (${response.tenantId})`,
        ),
      );
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

    addConversationEntry(makeEntry("caller", triageForm.message.trim()));

    try {
      const response = await sendTriage(
        { sessionId: triageForm.sessionId, message: triageForm.message },
        buildAuth(),
        triageForm.tenantId,
      );
      setLastResponse(response);
      addConversationEntry(
        makeEntry("assistant", formatAssistantResponse(response)),
      );
      setTriageForm((prev) => ({ ...prev, message: "" }));
    } catch (error) {
      const message =
        error instanceof ApiError
          ? `${error.status}: ${error.message}`
          : "Triage request failed.";
      setTriageError(message);
      addConversationEntry(makeEntry("assistant", `Error: ${message}`));
    } finally {
      setTriageLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <p className={styles.kicker}>Signmons CallDesk</p>
          <h1 className={styles.title}>Dispatch sandbox</h1>
          <p className={styles.subtle}>
            Requests are pointed at <code>{apiBase}</code>.
          </p>
        </div>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2>Dev auth panel</h2>
            <p className={styles.subtle}>
              Send dev headers with every request (offline friendly).
            </p>
          </header>

          <div className={styles.segmented}>
            <button
              type="button"
              className={
                authMode === "dev" ? styles.segmentActive : styles.segment
              }
              onClick={() => setAuthMode("dev")}
            >
              Dev auth
            </button>
            <button
              type="button"
              className={
                authMode === "admin" ? styles.segmentActive : styles.segment
              }
              onClick={() => setAuthMode("admin")}
            >
              Admin token
            </button>
          </div>

          {authMode === "dev" ? (
            <div className={styles.form}>
              <label className={styles.label}>
                Dev auth secret
                <input
                  className={styles.input}
                  value={devAuth.secret ?? ""}
                  onChange={(event) =>
                    setDevAuth((prev) => ({
                      ...prev,
                      secret: event.target.value,
                    }))
                  }
                  placeholder="dev-auth-secret"
                  autoComplete="off"
                />
              </label>

              <label className={styles.label}>
                Dev role
                <input
                  className={styles.input}
                  value={devAuth.role ?? ""}
                  onChange={(event) =>
                    setDevAuth((prev) => ({
                      ...prev,
                      role: event.target.value,
                    }))
                  }
                  placeholder="admin"
                  autoComplete="off"
                />
              </label>

              <label className={styles.label}>
                Dev user ID
                <input
                  className={styles.input}
                  value={devAuth.userId ?? ""}
                  onChange={(event) =>
                    setDevAuth((prev) => ({
                      ...prev,
                      userId: event.target.value,
                    }))
                  }
                  placeholder="dev-admin"
                  autoComplete="off"
                />
              </label>

              <label className={styles.label}>
                Dev tenant ID (optional)
                <input
                  className={styles.input}
                  value={devAuth.tenantId ?? ""}
                  onChange={(event) =>
                    setDevAuth((prev) => ({
                      ...prev,
                      tenantId: event.target.value,
                    }))
                  }
                  placeholder={triageForm.tenantId || "tenant-id"}
                  autoComplete="off"
                />
              </label>
            </div>
          ) : (
            <div className={styles.form}>
              <label className={styles.label}>
                Admin token
                <input
                  className={styles.input}
                  type="password"
                  value={adminToken}
                  onChange={(event) => setAdminToken(event.target.value)}
                  placeholder="Enter token at runtime"
                  autoComplete="off"
                />
              </label>
              <p className={styles.hint}>Only used for admin-only routes.</p>
            </div>
          )}
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2>Tenant onboarding</h2>
            <p className={styles.subtle}>
              Create a tenant profile and AI instructions.
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
                rows={5}
                required
              />
            </label>

            <button
              className={styles.button}
              type="submit"
              disabled={tenantLoading}
            >
              {tenantLoading ? "Creating..." : "Create tenant"}
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
                </ul>
              </div>
            )}
          </form>
        </section>

        {lastJob && (
          <section className={styles.panel}>
            <header className={styles.panelHeader}>
              <h2>Latest job</h2>
              <p className={styles.subtle}>Most recent job created by AI.</p>
            </header>
            <pre className={styles.codeBlock}>
              {JSON.stringify(lastJob, null, 2)}
            </pre>
          </section>
        )}
      </aside>

      <section className={styles.chat}>
        <header className={styles.chatHeader}>
          <div>
            <h2>Caller conversation</h2>
            <p className={styles.subtle}>
              Chat-style feed with the caller at the top.
            </p>
          </div>
          <div className={styles.chatFields}>
            <label className={styles.chatLabel}>
              Tenant ID
              <input
                className={styles.chatInput}
                value={triageForm.tenantId}
                onChange={(event) =>
                  setTriageForm((prev) => ({
                    ...prev,
                    tenantId: event.target.value,
                  }))
                }
                placeholder="tenant-id"
              />
            </label>
            <label className={styles.chatLabel}>
              Session ID
              <input
                className={styles.chatInput}
                value={triageForm.sessionId}
                onChange={(event) =>
                  setTriageForm((prev) => ({
                    ...prev,
                    sessionId: event.target.value,
                  }))
                }
                placeholder="caller-123"
              />
            </label>
          </div>
        </header>

        <div className={styles.messageList}>
          {conversation.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.muted}>
                No messages yet. Start a triage request below.
              </p>
            </div>
          ) : (
            conversation.map((entry) => (
              <div key={entry.id} className={styles.messageRow}>
                <span className={styles.messageMeta}>
                  {entry.timestamp} | {entry.role.toUpperCase()}
                </span>
                <div
                  className={`${styles.messageBubble} ${
                    entry.role === "caller"
                      ? styles.messageUser
                      : entry.role === "assistant"
                        ? styles.messageAssistant
                        : styles.messageSystem
                  }`}
                >
                  {entry.content}
                </div>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        <form className={styles.composer} onSubmit={handleTriageSubmit}>
          {triageError && (
            <p role="alert" className={styles.error}>
              {triageError}
            </p>
          )}
          <div className={styles.composerRow}>
            <textarea
              className={styles.composerInput}
              name="message"
              value={triageForm.message}
              onChange={(event) =>
                setTriageForm((prev) => ({
                  ...prev,
                  message: event.target.value,
                }))
              }
              rows={2}
              placeholder="Describe the issue from the caller's perspective..."
            />
            <button
              className={styles.button}
              type="submit"
              disabled={triageLoading}
            >
              {triageLoading ? "Sending..." : "Send"}
            </button>
          </div>
          <p className={styles.hint}>
            The message will appear above. The input stays fixed at the bottom.
          </p>
        </form>
      </section>
    </div>
  );
}
