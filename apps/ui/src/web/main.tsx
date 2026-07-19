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
  ReviewPresentationDecisionDto,
  ReviewEvidenceDto,
  RunEventDto,
  RunReviewDto,
} from "../api-types.js";

import {
  detectUiLocale,
  displayLabel,
  displayProductText,
  persistUiLocale,
  type UiLocale,
  type UiMessages,
  uiMessages,
} from "./i18n.js";

import "./styles.css";

const terminalStates = new Set(["completed", "failed", "cancelled", "stale"]);

function displayReviewText(
  source: string,
  translated: string | undefined,
  locale: UiLocale,
): string {
  return locale === "ja" && translated !== undefined
    ? translated
    : displayProductText(source, locale);
}

function stateLabel(state: string, messages: UiMessages): string {
  return displayLabel(messages.states, state);
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
  messages: UiMessages,
  signal?: AbortSignal,
): Promise<RunReviewDto> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(messages.requestFailed("review", response.status));
  return (await response.json()) as RunReviewDto;
}

async function streamEvents(
  runId: string,
  token: string,
  signal: AbortSignal,
  onEvent: (event: RunEventDto) => void,
  messages: UiMessages,
): Promise<void> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/events`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
    signal,
  });
  if (!response.ok || response.body === null) {
    throw new Error(messages.requestFailed("event", response.status));
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
  readonly locale: UiLocale;
  readonly messages: UiMessages;
  readonly translation: ReviewPresentationDecisionDto | null;
  readonly onResolve: (
    decision: DecisionCardDto,
    payload: Record<string, unknown>,
  ) => Promise<void>;
}

function DecisionCard({
  decision,
  disabled,
  locale,
  messages,
  translation,
  onResolve,
}: DecisionCardProps): JSX.Element {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [freeform, setFreeform] = useState("");
  const [validation, setValidation] = useState("");

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): Promise<void> {
    event.preventDefault();
    const override = freeform.trim();
    if (selectedOptionId === null && override.length === 0) {
      setValidation(messages.chooseOrEnter);
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
        <span className={`impact impact-${decision.impact}`}>
          {messages.impactLabel(decision.impact)}
        </span>
        <span>{displayLabel(messages.categories, decision.category)}</span>
        {decision.status === "deferred" ? <span>{messages.deferred}</span> : null}
      </div>
      {locale === "ja" && translation !== null ? (
        <p className="reference-label">{messages.referenceTranslation}</p>
      ) : null}
      <h3 id={`${decision.decisionId}-heading`}>
        {displayReviewText(decision.question, translation?.question, locale)}
      </h3>
      <p className="reason">{displayReviewText(decision.reason, translation?.reason, locale)}</p>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={disabled}>
          <legend>{messages.chooseDirection}</legend>
          <div className="options">
            {decision.options.map((option) => {
              const translatedOption = translation?.options.find(
                (candidate) => candidate.optionId === option.id,
              );
              return (
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
                    <strong>
                      {displayReviewText(option.label, translatedOption?.label, locale)}
                    </strong>
                  </span>
                  <span>
                    {displayReviewText(option.description, translatedOption?.description, locale)}
                  </span>
                  {option.effects.length > 0 ? (
                    <ul>
                      {option.effects.map((effect, index) => (
                        <li key={`${option.id}:${String(index)}`}>
                          {displayReviewText(effect, translatedOption?.effects[index], locale)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <span className="support">
                    {messages.probeSupport}:{" "}
                    {option.supportedByProbeIds.join(", ") || messages.none}
                  </span>
                </label>
              );
            })}
          </div>
          {decision.freeformAllowed ? (
            <label className="freeform">
              {messages.freeformDecision}
              <textarea
                rows={3}
                value={freeform}
                onChange={(event) => {
                  setFreeform(event.target.value);
                  setSelectedOptionId(null);
                  setValidation("");
                }}
                placeholder={messages.freeformPlaceholder}
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
              {messages.recordDecision}
            </button>
            <button
              type="button"
              disabled={decision.status === "deferred"}
              onClick={() => void onResolve(decision, { action: "defer" })}
            >
              {messages.defer}
            </button>
          </div>
        </fieldset>
      </form>
      {locale === "ja" && translation !== null ? (
        <details className="source-text">
          <summary>{messages.showSourceText}</summary>
          <h4>{messages.originalDecision}</h4>
          <p>
            <strong>{decision.question}</strong>
          </p>
          <p>{decision.reason}</p>
          {decision.options.map((option) => (
            <div className="source-option" key={`source:${option.id}`}>
              <p>
                <strong>{option.label}</strong>
              </p>
              <p>{option.description}</p>
              {option.effects.length > 0 ? (
                <ul>
                  {option.effects.map((effect, index) => (
                    <li key={`source:${option.id}:${String(index)}`}>{effect}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </details>
      ) : null}
      <details>
        <summary>{messages.evidenceAndTriggers}</summary>
        <dl className="evidence">
          <div>
            <dt>{messages.repositoryEvidence}</dt>
            <dd>{decision.evidenceRefs.join(", ") || messages.noReferences}</dd>
          </div>
          <div>
            <dt>{messages.deterministicTriggers}</dt>
            <dd>
              {decision.deterministicTriggers
                .map((trigger) => displayLabel(messages.triggers, trigger))
                .join(", ") || messages.none}
            </dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

interface LanguageSelectorProps {
  readonly locale: UiLocale;
  readonly messages: UiMessages;
  readonly onChange: (locale: UiLocale) => void;
}

function LanguageSelector({ locale, messages, onChange }: LanguageSelectorProps): JSX.Element {
  return (
    <nav className="language-selector" aria-label={messages.languageSelector}>
      <button
        type="button"
        aria-pressed={locale === "ja"}
        onClick={() => {
          onChange("ja");
        }}
      >
        日本語
      </button>
      <button
        type="button"
        aria-pressed={locale === "en"}
        onClick={() => {
          onChange("en");
        }}
      >
        English
      </button>
    </nav>
  );
}

function App(): JSX.Element {
  const bootstrap = initialBootstrap;
  const [locale, setLocale] = useState<UiLocale>(() => detectUiLocale());
  const messages = uiMessages[locale];
  const [review, setReview] = useState<RunReviewDto | null>(null);
  const [announcedState, setAnnouncedState] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<ReviewEvidenceDto | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  const observedVersion = useRef(-1);
  const japanesePresentation =
    locale === "ja" && review?.presentation?.status === "available" ? review.presentation : null;
  const translatedTask = japanesePresentation?.task ?? null;

  const applyReview = useCallback((next: RunReviewDto): void => {
    if (next.version < observedVersion.current) return;
    observedVersion.current = next.version;
    setReview(next);
    setAnnouncedState(next.state);
  }, []);

  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      if (bootstrap === null) return;
      const next = await fetchReview(bootstrap.runId, bootstrap.token, messages, signal);
      applyReview(next);
    },
    [applyReview, bootstrap, messages],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = messages.documentTitle;
    persistUiLocale(locale);
  }, [locale, messages]);

  useEffect(() => {
    if (bootstrap === null) return;
    const abort = new AbortController();
    void fetchReview(bootstrap.runId, bootstrap.token, messages, abort.signal)
      .then((next) => {
        applyReview(next);
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) {
          setError(cause instanceof Error ? cause.message : messages.reviewFailed);
        }
      });
    void streamEvents(
      bootstrap.runId,
      bootstrap.token,
      abort.signal,
      (event) => {
        setAnnouncedState(event.state);
        void refresh(abort.signal).catch((cause: unknown) => {
          if (!abort.signal.aborted) {
            setError(cause instanceof Error ? cause.message : messages.refreshFailed);
          }
        });
      },
      messages,
    ).catch((cause: unknown) => {
      if (!abort.signal.aborted) {
        setError(cause instanceof Error ? cause.message : messages.eventStreamFailed);
      }
    });
    return () => {
      abort.abort();
    };
  }, [applyReview, bootstrap, messages, refresh]);

  async function mutate(path: string, body: Record<string, unknown>): Promise<void> {
    if (bootstrap === null || review === null) return;
    if (review.mode === "recorded") {
      setError(messages.recordedMutationDenied);
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
        throw new Error(
          failure.code === undefined
            ? messages.requestFailed("review", response.status)
            : messages.mutationFailedWithCode(failure.code),
        );
      }
      await refresh();
      requestAnimationFrame(() => contentRef.current?.focus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.mutationFailed);
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
      if (!response.ok) throw new Error(messages.requestFailed("evidence", response.status));
      setEvidence((await response.json()) as ReviewEvidenceDto);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.evidenceRequestFailed);
    } finally {
      setEvidenceBusy(false);
    }
  }

  if (bootstrap === null) {
    return (
      <main className="shell">
        <div className="utility-row">
          <p className="eyebrow">PromptTripwire</p>
          <LanguageSelector locale={locale} messages={messages} onChange={setLocale} />
        </div>
        <h1>{messages.inboxTitle}</h1>
        <p role="alert">{messages.missingCapability}</p>
      </main>
    );
  }

  return (
    <main className="shell" ref={contentRef} tabIndex={-1}>
      <div className="utility-row">
        <p className="eyebrow">PromptTripwire</p>
        <LanguageSelector locale={locale} messages={messages} onChange={setLocale} />
      </div>
      <div className="title-row">
        <h1>{messages.inboxTitle}</h1>
        <span className="state-pill">
          {review === null ? messages.loading : stateLabel(review.state, messages)}
        </span>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcedState === null ? messages.loadingReview : stateLabel(announcedState, messages)}
      </p>
      {error.length > 0 ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {review?.mode === "recorded" ? (
        <aside className="recorded-banner" role="note">
          <strong>{messages.recordedTitle}</strong>
          <span>{messages.recordedDescription}</span>
        </aside>
      ) : null}
      {review === null ? (
        <section aria-labelledby="loading-heading">
          <h2 id="loading-heading">{messages.loadingReview}</h2>
        </section>
      ) : (
        <>
          <section className="summary" aria-labelledby="summary-heading">
            <div>
              <p className="section-label">{messages.taskAndSnapshot}</p>
              {translatedTask !== null ? (
                <p className="reference-label">{messages.referenceTranslation}</p>
              ) : null}
              <h2 id="summary-heading">
                {translatedTask ?? review.snapshot?.task ?? `Run ${review.runId}`}
              </h2>
              {locale === "ja" && japanesePresentation === null ? (
                <p className="translation-warning" role="note">
                  {messages.translationUnavailable}
                </p>
              ) : null}
              {translatedTask !== null && review.snapshot !== null ? (
                <details className="source-text task-source">
                  <summary>{messages.showSourceText}</summary>
                  <h3>{messages.originalTask}</h3>
                  <p>{review.snapshot.task}</p>
                </details>
              ) : null}
            </div>
            <dl>
              <div>
                <dt>{messages.repository}</dt>
                <dd>{review.snapshot?.repositoryPath ?? messages.notCaptured}</dd>
              </div>
              <div>
                <dt>{messages.snapshot}</dt>
                <dd>{review.snapshot?.commitSha.slice(0, 12) ?? messages.pending}</dd>
              </div>
              <div>
                <dt>{messages.branch}</dt>
                <dd>{review.snapshot?.branch ?? messages.detached}</dd>
              </div>
            </dl>
          </section>

          {review.decisions.length > 0 ? (
            <section aria-labelledby="decisions-heading">
              <div className="section-heading">
                <div>
                  <p className="section-label">{messages.explicitChoices}</p>
                  <h2 id="decisions-heading">{messages.decisionsRequiringReview}</h2>
                </div>
                <p>
                  {messages.shownDecisions(review.decisions.length, review.remainingDecisionCount)}
                </p>
              </div>
              <p className="source-text-notice">{messages.sourceTextNotice}</p>
              <div className="decision-grid">
                {review.decisions.map((decision) => (
                  <DecisionCard
                    key={decision.decisionId}
                    decision={decision}
                    disabled={busy || review.mode === "recorded"}
                    locale={locale}
                    messages={messages}
                    translation={
                      japanesePresentation?.decisions.find(
                        (candidate) => candidate.decisionId === decision.decisionId,
                      ) ?? null
                    }
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
              <p className="section-label">{messages.consolidatedContract}</p>
              <h2 id="contract-heading">{messages.approveBoundedExecution}</h2>
              <p>{translatedTask ?? review.contract.approvedGoal}</p>
              <div className="contract-columns">
                <div>
                  <h3>{messages.allowedPaths}</h3>
                  <ul>
                    {review.contract.allowedPaths.map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>{messages.requiredChecks}</h3>
                  <ul>
                    {review.contract.requiredChecks.map((check) => (
                      <li key={check}>{check}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>{messages.stopConditions}</h3>
                  <ul>
                    {review.contract.stopConditions.map((condition) => (
                      <li key={condition}>{displayProductText(condition, locale)}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="contract-hash">
                {messages.contractHash}: {review.contract.contentHash}
              </p>
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
                    {messages.approveContract}
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
                      {messages.editDecisions}
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="success">{stateLabel(review.state, messages)}</p>
              )}
            </section>
          ) : null}

          <section aria-labelledby="evidence-heading">
            <h2 id="evidence-heading">{messages.planningEvidence}</h2>
            <details className="plan-evidence">
              <summary>{messages.openPlanArtifacts}</summary>
              {evidence === null ? (
                <button type="button" disabled={evidenceBusy} onClick={() => void loadEvidence()}>
                  {evidenceBusy ? messages.loadingEvidence : messages.loadPlanArtifacts}
                </button>
              ) : (
                <div className="plan-list">
                  {evidence.plans.map((plan) => (
                    <article key={plan.probeId}>
                      <h3>
                        {messages.probe} {plan.probeId}
                      </h3>
                      <pre>{JSON.stringify(plan, null, 2)}</pre>
                    </article>
                  ))}
                </div>
              )}
            </details>
          </section>

          {review.deviations.length > 0 ? (
            <section aria-labelledby="deviations-heading">
              <h2 id="deviations-heading">{messages.observedDeviations}</h2>
              {review.deviations.map((deviation) => (
                <article className="deviation" key={deviation.deviationId}>
                  <h3>{displayLabel(messages.categories, deviation.category)}</h3>
                  <p>{deviation.summary}</p>
                  <p>{deviation.resolution ?? messages.resolutionRequired}</p>
                </article>
              ))}
            </section>
          ) : null}

          {!terminalStates.has(review.state) && review.mode === "live" ? (
            <section className="cancel-zone" aria-labelledby="cancel-heading">
              <div>
                <h2 id="cancel-heading">{messages.stopRun}</h2>
                <p>{messages.cancellationDescription}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void mutate(`/api/runs/${encodeURIComponent(review.runId)}/cancel`, {})
                }
              >
                {messages.cancelRun}
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
