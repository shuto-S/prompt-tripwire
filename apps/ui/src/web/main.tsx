import {
  StrictMode,
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type SyntheticEvent,
} from "react";
import { createRoot } from "react-dom/client";

import type {
  DecisionCardDto,
  ReviewEvidenceDto,
  RunEventDto,
  RunReviewDto,
} from "../api-types.js";

import "./styles.css";

const stateLabels: Readonly<Record<string, string>> = {
  created: "Created",
  snapshotting: "Capturing repository snapshot",
  probing: "Planning probes are running",
  comparing: "Comparing plans",
  needs_review: "Decisions require review",
  ready_for_approval: "Contract is ready for approval",
  approved: "Contract approved",
  running: "Execution is running",
  pausing: "Execution is pausing",
  paused: "Execution paused for review",
  completed: "Execution completed",
  failed: "Run failed",
  cancelled: "Run cancelled",
  stale: "Snapshot is stale",
};
const terminalStates = new Set(["completed", "failed", "cancelled", "stale"]);

function stateLabel(state: string): string {
  return stateLabels[state] ?? state;
}

function readBootstrap(): { runId: string; token: string } | null {
  const match = window.location.pathname.match(/^\/runs\/([^/]+)$/u);
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("token");
  if (match?.[1] === undefined || token === null || token.length === 0) return null;
  window.history.replaceState(null, "", window.location.pathname);
  return { runId: decodeURIComponent(match[1]), token };
}

const initialBootstrap = readBootstrap();

async function fetchReview(
  runId: string,
  token: string,
  signal?: AbortSignal,
): Promise<RunReviewDto> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`Review request failed (${String(response.status)})`);
  return (await response.json()) as RunReviewDto;
}

async function streamEvents(
  runId: string,
  token: string,
  signal: AbortSignal,
  onEvent: (event: RunEventDto) => void,
): Promise<void> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/events`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
    signal,
  });
  if (!response.ok || response.body === null) {
    throw new Error(`Event stream failed (${String(response.status)})`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (!signal.aborted) {
    const result = await reader.read();
    if (result.done) return;
    buffer += result.value;
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
      if (dataLine !== undefined) onEvent(JSON.parse(dataLine.slice(6)) as RunEventDto);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

interface DecisionCardProps {
  readonly decision: DecisionCardDto;
  readonly disabled: boolean;
  readonly onResolve: (
    decision: DecisionCardDto,
    payload: Record<string, unknown>,
  ) => Promise<void>;
}

function DecisionCard({ decision, disabled, onResolve }: DecisionCardProps): JSX.Element {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [freeform, setFreeform] = useState("");
  const [validation, setValidation] = useState("");

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): Promise<void> {
    event.preventDefault();
    const override = freeform.trim();
    if (selectedOptionId === null && override.length === 0) {
      setValidation("Choose one option or enter a free-form decision.");
      return;
    }
    setValidation("");
    await onResolve(
      decision,
      selectedOptionId === null
        ? { action: "freeform", freeformOverride: override }
        : { action: "select", selectedOptionId },
    );
  }

  return (
    <article className="decision-card" aria-labelledby={`${decision.decisionId}-heading`}>
      <div className="card-meta">
        <span className={`impact impact-${decision.impact}`}>{decision.impact} impact</span>
        <span>{decision.category.replaceAll("_", " ")}</span>
        {decision.status === "deferred" ? <span>Deferred</span> : null}
      </div>
      <h3 id={`${decision.decisionId}-heading`}>{decision.question}</h3>
      <p className="reason">{decision.reason}</p>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={disabled}>
          <legend>Choose an explicit direction</legend>
          <div className="options">
            {decision.options.map((option) => (
              <label className="option" key={option.id}>
                <span className="option-heading">
                  <input
                    type="radio"
                    name={`${decision.decisionId}-option`}
                    value={option.id}
                    checked={selectedOptionId === option.id}
                    onChange={() => {
                      setSelectedOptionId(option.id);
                      setFreeform("");
                      setValidation("");
                    }}
                  />
                  <strong>{option.label}</strong>
                </span>
                <span>{option.description}</span>
                {option.effects.length > 0 ? (
                  <ul>
                    {option.effects.map((effect) => (
                      <li key={effect}>{effect}</li>
                    ))}
                  </ul>
                ) : null}
                <span className="support">
                  Probe support: {option.supportedByProbeIds.join(", ") || "none"}
                </span>
              </label>
            ))}
          </div>
          {decision.freeformAllowed ? (
            <label className="freeform">
              Free-form decision
              <textarea
                rows={3}
                value={freeform}
                onChange={(event) => {
                  setFreeform(event.target.value);
                  setSelectedOptionId(null);
                  setValidation("");
                }}
                placeholder="Describe the exact behavior you want"
              />
            </label>
          ) : null}
          {validation.length > 0 ? (
            <p className="validation" role="alert">
              {validation}
            </p>
          ) : null}
          <div className="card-actions">
            <button className="primary" type="submit">
              Record decision
            </button>
            <button
              type="button"
              disabled={decision.status === "deferred"}
              onClick={() => void onResolve(decision, { action: "defer" })}
            >
              Defer
            </button>
          </div>
        </fieldset>
      </form>
      <details>
        <summary>Evidence and policy triggers</summary>
        <dl className="evidence">
          <div>
            <dt>Repository evidence</dt>
            <dd>{decision.evidenceRefs.join(", ") || "No references supplied"}</dd>
          </div>
          <div>
            <dt>Deterministic triggers</dt>
            <dd>{decision.deterministicTriggers.join(", ") || "None"}</dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

function App(): JSX.Element {
  const bootstrap = initialBootstrap;
  const [review, setReview] = useState<RunReviewDto | null>(null);
  const [announcement, setAnnouncement] = useState("Loading review");
  const [error, setError] = useState(
    bootstrap === null ? "This review link has no capability token." : "",
  );
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<ReviewEvidenceDto | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  const observedVersion = useRef(-1);

  const applyReview = useCallback((next: RunReviewDto): void => {
    if (next.version < observedVersion.current) return;
    observedVersion.current = next.version;
    setReview(next);
    setAnnouncement(stateLabel(next.state));
  }, []);

  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      if (bootstrap === null) return;
      const next = await fetchReview(bootstrap.runId, bootstrap.token, signal);
      applyReview(next);
    },
    [applyReview, bootstrap],
  );

  useEffect(() => {
    if (bootstrap === null) return;
    const abort = new AbortController();
    void fetchReview(bootstrap.runId, bootstrap.token, abort.signal)
      .then((next) => {
        applyReview(next);
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Review failed");
        }
      });
    void streamEvents(bootstrap.runId, bootstrap.token, abort.signal, (event) => {
      setAnnouncement(stateLabel(event.state));
      void refresh(abort.signal).catch((cause: unknown) => {
        if (!abort.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Refresh failed");
        }
      });
    }).catch((cause: unknown) => {
      if (!abort.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Event stream failed");
    });
    return () => {
      abort.abort();
    };
  }, [applyReview, bootstrap, refresh]);

  async function mutate(path: string, body: Record<string, unknown>): Promise<void> {
    if (bootstrap === null || review === null) return;
    if (review.mode === "recorded") {
      setError("Recorded replay is read-only. Run a live inspection to make decisions.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bootstrap.token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `ui:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ ...body, expectedVersion: review.version }),
      });
      if (!response.ok) {
        const failure = (await response.json()) as { code?: string };
        throw new Error(failure.code ?? `Mutation failed (${String(response.status)})`);
      }
      await refresh();
      requestAnimationFrame(() => contentRef.current?.focus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mutation failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadEvidence(): Promise<void> {
    if (bootstrap === null || evidence !== null) return;
    setEvidenceBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(bootstrap.runId)}/evidence`, {
        headers: { Authorization: `Bearer ${bootstrap.token}` },
      });
      if (!response.ok) throw new Error(`Evidence request failed (${String(response.status)})`);
      setEvidence((await response.json()) as ReviewEvidenceDto);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Evidence request failed");
    } finally {
      setEvidenceBusy(false);
    }
  }

  if (bootstrap === null) {
    return (
      <main className="shell">
        <h1>Decision Inbox</h1>
        <p role="alert">{error}</p>
      </main>
    );
  }

  return (
    <main className="shell" ref={contentRef} tabIndex={-1}>
      <p className="eyebrow">PromptTripwire</p>
      <div className="title-row">
        <h1>Decision Inbox</h1>
        <span className="state-pill">{review === null ? "Loading" : stateLabel(review.state)}</span>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {error.length > 0 ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {review?.mode === "recorded" ? (
        <aside className="recorded-banner" role="note">
          <strong>Recorded replay · read-only</strong>
          <span>
            This sanitized example does not call Codex or execute code. Use the judge fixture for
            live verification.
          </span>
        </aside>
      ) : null}
      {review === null ? (
        <section aria-labelledby="loading-heading">
          <h2 id="loading-heading">Loading review</h2>
        </section>
      ) : (
        <>
          <section className="summary" aria-labelledby="summary-heading">
            <div>
              <p className="section-label">Task and snapshot</p>
              <h2 id="summary-heading">{review.snapshot?.task ?? `Run ${review.runId}`}</h2>
            </div>
            <dl>
              <div>
                <dt>Repository</dt>
                <dd>{review.snapshot?.repositoryPath ?? "Not captured"}</dd>
              </div>
              <div>
                <dt>Snapshot</dt>
                <dd>{review.snapshot?.commitSha.slice(0, 12) ?? "Pending"}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>{review.snapshot?.branch ?? "Detached"}</dd>
              </div>
            </dl>
          </section>

          {review.decisions.length > 0 ? (
            <section aria-labelledby="decisions-heading">
              <div className="section-heading">
                <div>
                  <p className="section-label">Explicit choices</p>
                  <h2 id="decisions-heading">Decisions requiring review</h2>
                </div>
                <p>
                  {String(review.decisions.length)} shown
                  {review.remainingDecisionCount > 0
                    ? ` · ${String(review.remainingDecisionCount)} remaining after these`
                    : ""}
                </p>
              </div>
              <div className="decision-grid">
                {review.decisions.map((decision) => (
                  <DecisionCard
                    key={decision.decisionId}
                    decision={decision}
                    disabled={busy || review.mode === "recorded"}
                    onResolve={async (item, payload) => {
                      await mutate(
                        `/api/runs/${encodeURIComponent(review.runId)}/decisions/${encodeURIComponent(item.decisionId)}`,
                        payload,
                      );
                    }}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {review.contract !== null ? (
            <section className="contract" aria-labelledby="contract-heading">
              <p className="section-label">Consolidated contract</p>
              <h2 id="contract-heading">Approve the bounded execution</h2>
              <p>{review.contract.approvedGoal}</p>
              <div className="contract-columns">
                <div>
                  <h3>Allowed paths</h3>
                  <ul>
                    {review.contract.allowedPaths.map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>Required checks</h3>
                  <ul>
                    {review.contract.requiredChecks.map((check) => (
                      <li key={check}>{check}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>Stop conditions</h3>
                  <ul>
                    {review.contract.stopConditions.map((condition) => (
                      <li key={condition}>{condition}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="contract-hash">Contract hash: {review.contract.contentHash}</p>
              {review.state === "ready_for_approval" && review.mode === "live" ? (
                <div className="card-actions">
                  <button
                    className="primary"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        `/api/runs/${encodeURIComponent(review.runId)}/contracts/approve`,
                        {
                          contractId: review.contract?.contractId,
                        },
                      )
                    }
                  >
                    Approve contract
                  </button>
                  {review.resolvedDecisionCount > 0 ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          `/api/runs/${encodeURIComponent(review.runId)}/contracts/reopen`,
                          {},
                        )
                      }
                    >
                      Edit decisions
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="success">{stateLabel(review.state)}</p>
              )}
            </section>
          ) : null}

          <section aria-labelledby="evidence-heading">
            <h2 id="evidence-heading">Planning evidence</h2>
            <details className="plan-evidence">
              <summary>Open full sanitized plan artifacts</summary>
              {evidence === null ? (
                <button type="button" disabled={evidenceBusy} onClick={() => void loadEvidence()}>
                  {evidenceBusy ? "Loading evidence" : "Load plan artifacts"}
                </button>
              ) : (
                <div className="plan-list">
                  {evidence.plans.map((plan) => (
                    <article key={plan.probeId}>
                      <h3>Probe {plan.probeId}</h3>
                      <pre>{JSON.stringify(plan, null, 2)}</pre>
                    </article>
                  ))}
                </div>
              )}
            </details>
          </section>

          {review.deviations.length > 0 ? (
            <section aria-labelledby="deviations-heading">
              <h2 id="deviations-heading">Observed deviations</h2>
              {review.deviations.map((deviation) => (
                <article className="deviation" key={deviation.deviationId}>
                  <h3>{deviation.category}</h3>
                  <p>{deviation.summary}</p>
                  <p>{deviation.resolution ?? "Resolution required"}</p>
                </article>
              ))}
            </section>
          ) : null}

          {!terminalStates.has(review.state) && review.mode === "live" ? (
            <section className="cancel-zone" aria-labelledby="cancel-heading">
              <div>
                <h2 id="cancel-heading">Stop this run</h2>
                <p>Cancellation does not execute or modify the target repository.</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void mutate(`/api/runs/${encodeURIComponent(review.runId)}/cancel`, {})
                }
              >
                Cancel run
              </button>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

const root = document.getElementById("root");
if (root === null) throw new TypeError("root element is missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
