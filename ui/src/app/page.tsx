"use client";

import { FormEvent, useMemo, useState } from "react";
import styles from "./page.module.css";
import {
  ApiError,
  ConversationResponse,
  JobResponse,
  TenantResponse,
  TriageResponse,
  createConversation,
  createJob,
  createTenant,
  getApiBaseUrl,
  listConversations,
  listJobs,
  sendTriage,
} from "@/lib/api";

type ConversationEntry = {
  role: "caller" | "assistant" | "system";
  content: string;
  timestamp: string;
};

type ReplyResponse = Extract<TriageResponse, { status: "reply" }>;
type JobCreatedResponse = Extract<TriageResponse, { status: "job_created" }>;

const isReplyResponse = (payload: TriageResponse): payload is ReplyResponse =>
  typeof payload === "object" &&
  payload !== null &&
  "status" in payload &&
  payload.status === "reply" &&
  "reply" in payload;

const isJobCreatedResponse = (
  payload: TriageResponse,
): payload is JobCreatedResponse =>
  typeof payload === "object" &&
  payload !== null &&
  "status" in payload &&
  payload.status === "job_created" &&
  "job" in payload;

const defaultInstructions =
  "Greet callers with a warm \"Thanks for calling Demo HVAC, this is your dispatcher\" intro. Collect contact info, classify the issue, and reassure them we handle everything. Be transparent about our $99 diagnostic/service fee and let callers know it is credited toward repairs if they approve work within 24 hours. Always look for tasteful upsell moments (maintenance plans, priority booking) after understanding their problem. Close with a concise summary of what will happen next.";

const formatAssistantResponse = (payload: TriageResponse): string => {
  if (isReplyResponse(payload)) {
    return payload.reply ?? "";
  }

  if (isJobCreatedResponse(payload)) {
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

  return JSON.stringify(payload);
};

const formatJson = (payload: unknown): string =>
  JSON.stringify(payload, null, 2);

export default function Home() {
  const apiBase = useMemo(() => getApiBaseUrl(), []);

  const [tenantForm, setTenantForm] = useState({
    name: "demo_hvac",
    timezone: "",
    settings: {
      displayName: "Demo HVAC Contractor",
      instructions: defaultInstructions,
    },
    adminToken: "",
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

  const [jobForm, setJobForm] = useState({
    tenantId: "",
    customerId: "",
    propertyAddressId: "",
    serviceCategoryId: "",
    urgency: "STANDARD",
    description: "",
    preferredWindowLabel: "",
  });
  const [jobLoading, setJobLoading] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobResult, setJobResult] = useState<JobResponse | null>(null);
  const [jobsTenantId, setJobsTenantId] = useState("");
  const [jobsList, setJobsList] = useState<JobResponse[]>([]);
  const [jobsListLoading, setJobsListLoading] = useState(false);
  const [jobsListError, setJobsListError] = useState<string | null>(null);

  const [conversationForm, setConversationForm] = useState({
    tenantId: "",
    customerId: "",
    channel: "WEBCHAT",
    currentFSMState: "INTAKE",
    providerConversationId: "",
    collectedData: "",
  });
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(
    null,
  );
  const [conversationResult, setConversationResult] =
    useState<ConversationResponse | null>(null);
  const [conversationsTenantId, setConversationsTenantId] = useState("");
  const [conversationsList, setConversationsList] = useState<
    ConversationResponse[]
  >([]);
  const [conversationsListLoading, setConversationsListLoading] =
    useState(false);
  const [conversationsListError, setConversationsListError] = useState<
    string | null
  >(null);

  const lastJob = useMemo(() => {
    if (lastResponse && isJobCreatedResponse(lastResponse)) {
      return lastResponse.job;
    }
    return null;
  }, [lastResponse]);

  const addConversationEntry = (entry: ConversationEntry) => {
    setConversation((prev) => [...prev, entry]);
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
      const response = await createTenant({
        ...tenantForm,
        timezone: tenantForm.timezone.trim() || undefined,
      });
      setTenantResult(response);
      const tenantDisplayName =
        response.settings?.displayName?.trim() || response.name;
      addConversationEntry({
        role: "system",
        content: `Tenant created: ${tenantDisplayName} (${response.tenantId})`,
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

  const handleJobSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setJobLoading(true);
    setJobError(null);

    try {
      const response = await createJob({
        tenantId: jobForm.tenantId.trim(),
        customerId: jobForm.customerId.trim(),
        propertyAddressId: jobForm.propertyAddressId.trim(),
        serviceCategoryId: jobForm.serviceCategoryId.trim(),
        urgency: jobForm.urgency === "EMERGENCY" ? "EMERGENCY" : "STANDARD",
        description: jobForm.description.trim() || undefined,
        preferredWindowLabel: jobForm.preferredWindowLabel
          ? (jobForm.preferredWindowLabel as
              | "ASAP"
              | "MORNING"
              | "AFTERNOON"
              | "EVENING")
          : undefined,
      });
      setJobResult(response);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? `${error.status}: ${error.message}`
          : "Unable to create job.";
      setJobError(message);
    } finally {
      setJobLoading(false);
    }
  };

  const handleJobsList = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setJobsListLoading(true);
    setJobsListError(null);

    try {
      const tenantId = jobsTenantId.trim();
      const response = await listJobs(tenantId);
      setJobsList(response);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? `${error.status}: ${error.message}`
          : "Unable to load jobs.";
      setJobsListError(message);
    } finally {
      setJobsListLoading(false);
    }
  };

  const handleConversationSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setConversationLoading(true);
    setConversationError(null);

    try {
      const collectedDataRaw = conversationForm.collectedData.trim();
      const collectedData = collectedDataRaw
        ? (JSON.parse(collectedDataRaw) as Record<string, unknown>)
        : undefined;
      const response = await createConversation({
        tenantId: conversationForm.tenantId.trim(),
        customerId: conversationForm.customerId.trim(),
        channel: conversationForm.channel as "VOICE" | "SMS" | "WEBCHAT",
        currentFSMState: conversationForm.currentFSMState.trim() || undefined,
        providerConversationId:
          conversationForm.providerConversationId.trim() || undefined,
        collectedData,
      });
      setConversationResult(response);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? `${error.status}: ${error.message}`
          : error instanceof SyntaxError
            ? "Collected data must be valid JSON."
            : "Unable to create conversation.";
      setConversationError(message);
    } finally {
      setConversationLoading(false);
    }
  };

  const handleConversationsList = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setConversationsListLoading(true);
    setConversationsListError(null);

    try {
      const tenantId = conversationsTenantId.trim();
      const response = await listConversations(tenantId);
      setConversationsList(response);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? `${error.status}: ${error.message}`
          : "Unable to load conversations.";
      setConversationsListError(message);
    } finally {
      setConversationsListLoading(false);
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
              Timezone (optional)
              <input
                className={styles.input}
                name="timezone"
                value={tenantForm.timezone}
                onChange={(event) =>
                  setTenantForm((prev) => ({
                    ...prev,
                    timezone: event.target.value,
                  }))
                }
                autoComplete="off"
                placeholder="America/Chicago"
              />
            </label>

            <label className={styles.label}>
              Display name
              <input
                className={styles.input}
                name="displayName"
                value={tenantForm.settings.displayName ?? ""}
                onChange={(event) =>
                  setTenantForm((prev) => ({
                    ...prev,
                    settings: {
                      ...prev.settings,
                      displayName: event.target.value,
                    },
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
                value={tenantForm.settings.instructions ?? ""}
                onChange={(event) =>
                  setTenantForm((prev) => ({
                    ...prev,
                    settings: {
                      ...prev.settings,
                      instructions: event.target.value,
                    },
                  }))
                }
                rows={4}
                required
              />
            </label>

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
                    <strong>Display:</strong>{" "}
                    {tenantResult.settings?.displayName ?? tenantResult.name}
                  </li>
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

        <section className={styles.card}>
          <header>
            <h2>Jobs</h2>
            <p>Create and list jobs directly against the API.</p>
          </header>

          <form className={styles.form} onSubmit={handleJobSubmit}>
            <label className={styles.label}>
              Tenant ID
              <input
                className={styles.input}
                name="jobTenantId"
                value={jobForm.tenantId}
                onChange={(event) =>
                  setJobForm((prev) => ({
                    ...prev,
                    tenantId: event.target.value,
                  }))
                }
                required
              />
            </label>

            <label className={styles.label}>
              Customer ID
              <input
                className={styles.input}
                name="customerId"
                value={jobForm.customerId}
                onChange={(event) =>
                  setJobForm((prev) => ({
                    ...prev,
                    customerId: event.target.value,
                  }))
                }
                required
              />
            </label>

            <label className={styles.label}>
              Property Address ID
              <input
                className={styles.input}
                name="propertyAddressId"
                value={jobForm.propertyAddressId}
                onChange={(event) =>
                  setJobForm((prev) => ({
                    ...prev,
                    propertyAddressId: event.target.value,
                  }))
                }
                required
              />
            </label>

            <label className={styles.label}>
              Service Category ID
              <input
                className={styles.input}
                name="serviceCategoryId"
                value={jobForm.serviceCategoryId}
                onChange={(event) =>
                  setJobForm((prev) => ({
                    ...prev,
                    serviceCategoryId: event.target.value,
                  }))
                }
                required
              />
            </label>

            <label className={styles.label}>
              Urgency
              <select
                className={styles.input}
                name="urgency"
                value={jobForm.urgency}
                onChange={(event) =>
                  setJobForm((prev) => ({
                    ...prev,
                    urgency: event.target.value,
                  }))
                }
              >
                <option value="STANDARD">Standard</option>
                <option value="EMERGENCY">Emergency</option>
              </select>
            </label>

            <label className={styles.label}>
              Preferred window
              <select
                className={styles.input}
                name="preferredWindowLabel"
                value={jobForm.preferredWindowLabel}
                onChange={(event) =>
                  setJobForm((prev) => ({
                    ...prev,
                    preferredWindowLabel: event.target.value,
                  }))
                }
              >
                <option value="">None</option>
                <option value="ASAP">ASAP</option>
                <option value="MORNING">Morning</option>
                <option value="AFTERNOON">Afternoon</option>
                <option value="EVENING">Evening</option>
              </select>
            </label>

            <label className={styles.label}>
              Description (optional)
              <textarea
                className={styles.textarea}
                name="description"
                rows={3}
                value={jobForm.description}
                onChange={(event) =>
                  setJobForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
              />
            </label>

            <button
              className={styles.button}
              type="submit"
              disabled={jobLoading}
            >
              {jobLoading ? "Creating…" : "Create job"}
            </button>

            {jobError && (
              <p role="alert" className={styles.error}>
                {jobError}
              </p>
            )}

            {jobResult && (
              <div className={styles.success}>
                <p>Job created.</p>
                <pre className={styles.codeBlock}>
                  {formatJson(jobResult)}
                </pre>
              </div>
            )}
          </form>

          <div className={styles.timeline}>
            <h3>List jobs</h3>
            <form className={styles.form} onSubmit={handleJobsList}>
              <label className={styles.label}>
                Tenant ID
                <input
                  className={styles.input}
                  name="jobsTenantId"
                  value={jobsTenantId}
                  onChange={(event) => setJobsTenantId(event.target.value)}
                  required
                />
              </label>
              <button
                className={styles.button}
                type="submit"
                disabled={jobsListLoading}
              >
                {jobsListLoading ? "Loading…" : "Fetch jobs"}
              </button>
            </form>

            {jobsListError && (
              <p role="alert" className={styles.error}>
                {jobsListError}
              </p>
            )}

            {jobsList.length ? (
              <pre className={styles.codeBlock}>
                {formatJson(jobsList)}
              </pre>
            ) : (
              <p className={styles.muted}>No jobs loaded yet.</p>
            )}
          </div>
        </section>

        <section className={styles.card}>
          <header>
            <h2>Conversations</h2>
            <p>Create conversations and review recent entries.</p>
          </header>

          <form className={styles.form} onSubmit={handleConversationSubmit}>
            <label className={styles.label}>
              Tenant ID
              <input
                className={styles.input}
                name="conversationTenantId"
                value={conversationForm.tenantId}
                onChange={(event) =>
                  setConversationForm((prev) => ({
                    ...prev,
                    tenantId: event.target.value,
                  }))
                }
                required
              />
            </label>

            <label className={styles.label}>
              Customer ID
              <input
                className={styles.input}
                name="conversationCustomerId"
                value={conversationForm.customerId}
                onChange={(event) =>
                  setConversationForm((prev) => ({
                    ...prev,
                    customerId: event.target.value,
                  }))
                }
                required
              />
            </label>

            <label className={styles.label}>
              Channel
              <select
                className={styles.input}
                name="channel"
                value={conversationForm.channel}
                onChange={(event) =>
                  setConversationForm((prev) => ({
                    ...prev,
                    channel: event.target.value,
                  }))
                }
              >
                <option value="WEBCHAT">Webchat</option>
                <option value="SMS">SMS</option>
                <option value="VOICE">Voice</option>
              </select>
            </label>

            <label className={styles.label}>
              Current FSM state
              <input
                className={styles.input}
                name="currentFSMState"
                value={conversationForm.currentFSMState}
                onChange={(event) =>
                  setConversationForm((prev) => ({
                    ...prev,
                    currentFSMState: event.target.value,
                  }))
                }
              />
            </label>

            <label className={styles.label}>
              Provider conversation ID (optional)
              <input
                className={styles.input}
                name="providerConversationId"
                value={conversationForm.providerConversationId}
                onChange={(event) =>
                  setConversationForm((prev) => ({
                    ...prev,
                    providerConversationId: event.target.value,
                  }))
                }
              />
            </label>

            <label className={styles.label}>
              Collected data (JSON)
              <textarea
                className={styles.textarea}
                name="collectedData"
                rows={3}
                placeholder='{"issue":"no heat","urgency":"high"}'
                value={conversationForm.collectedData}
                onChange={(event) =>
                  setConversationForm((prev) => ({
                    ...prev,
                    collectedData: event.target.value,
                  }))
                }
              />
            </label>

            <button
              className={styles.button}
              type="submit"
              disabled={conversationLoading}
            >
              {conversationLoading ? "Creating…" : "Create conversation"}
            </button>

            {conversationError && (
              <p role="alert" className={styles.error}>
                {conversationError}
              </p>
            )}

            {conversationResult && (
              <div className={styles.success}>
                <p>Conversation created.</p>
                <pre className={styles.codeBlock}>
                  {formatJson(conversationResult)}
                </pre>
              </div>
            )}
          </form>

          <div className={styles.timeline}>
            <h3>List conversations</h3>
            <form className={styles.form} onSubmit={handleConversationsList}>
              <label className={styles.label}>
                Tenant ID
                <input
                  className={styles.input}
                  name="conversationsTenantId"
                  value={conversationsTenantId}
                  onChange={(event) =>
                    setConversationsTenantId(event.target.value)
                  }
                  required
                />
              </label>
              <button
                className={styles.button}
                type="submit"
                disabled={conversationsListLoading}
              >
                {conversationsListLoading ? "Loading…" : "Fetch conversations"}
              </button>
            </form>

            {conversationsListError && (
              <p role="alert" className={styles.error}>
                {conversationsListError}
              </p>
            )}

            {conversationsList.length ? (
              <pre className={styles.codeBlock}>
                {formatJson(conversationsList)}
              </pre>
            ) : (
              <p className={styles.muted}>No conversations loaded yet.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
