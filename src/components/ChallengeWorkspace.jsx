import { useCallback, useEffect, useRef, useState } from "react";
import CodeEditor from "./CodeEditor";
import ErrorMessage from "./ErrorMessage";
import Icon from "./Icon";
import Markdown from "./Markdown";
import ReplaceCodeDialog from "./ReplaceCodeDialog";
import { DifficultyBadge, MedalBadge, Tags } from "./ChallengeList";
import { OpenButton, ResultList, TestValues } from "./ChallengeResults";
import { failureFrom, requestJson, visualizerProgram } from "../challenges/problems";
import { clearDraft, loadDraftRecord, loadProgress, recordAttempt, saveDraft } from "../challenges/storage";
import { medalLabel, resultHeadline } from "../challenges/scoring";
import { metricsText, relativeTime } from "../challenges/submissions";
import { accountApi, loginUrl } from "../account";
import "../challenges/challenges.css";

// Remembers, across the trip to Google, which problem was being submitted.
const RETURN_KEY = "assembly-visualizer-submit-after-login";
const DRAFT_SYNC_DELAY = 800;

function rememberReturn(slug) {
    try {
        sessionStorage.setItem(RETURN_KEY, slug);
    } catch {
        // Without it, the student simply returns without the welcome note.
    }
}

function returningTo(slug) {
    try {
        return sessionStorage.getItem(RETURN_KEY) === slug;
    } catch {
        return false;
    }
}

function forgetReturn() {
    try {
        sessionStorage.removeItem(RETURN_KEY);
    } catch {
        // Nothing to forget.
    }
}

const NO_PROGRESS = Object.freeze({ attempted: false, solved: false, best: null });

function RunResults({ response, busy, error, onOpen, formats }) {
    if (busy) return <p className="results-empty" role="status">Running the visible tests…</p>;
    if (error) return <ErrorMessage error={error} formats={formats} />;
    if (!response) {
        return <p className="results-empty">
            Run checks your code against the visible tests. Submit runs every test, hidden ones included,
            and opens a page with your result.
        </p>;
    }
    const headline = resultHeadline(response);
    return (
        <div className="results-body">
            <p className={`results-headline ${headline.accepted ? "verdict-accepted" : "verdict-failed"}`} role="status">
                <strong>{headline.verdict}</strong>
                <span>{headline.counts} · Submit to run the hidden tests</span>
            </p>
            <ResultList results={response.results} onOpen={onOpen} formats={formats} />
        </div>
    );
}

export function VerdictText({ submission }) {
    const tone = submission.status === "judging" ? "judging"
        : submission.verdict === "accepted" ? "accepted" : "failed";
    return <span className={`verdict-text verdict-text-${tone}`}>{submission.verdict_label}</span>;
}

function SubmissionHistory({ slug, user }) {
    const [rows, setRows] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!user) return undefined;
        const controller = new AbortController();
        accountApi.history(slug, controller.signal)
            .then((data) => setRows(data.submissions))
            .catch((failure) => {
                if (failure?.name !== "AbortError") setError(failureFrom(failure));
            });
        return () => controller.abort();
    }, [slug, user]);

    if (!user) {
        return <div className="history-empty">
            <p>Sign in to submit solutions and keep a history of your attempts.</p>
            <a className="button-link primary" href={loginUrl(`#/problems/${slug}/submissions`)}>Sign in with Google</a>
        </div>;
    }
    if (error) return <ErrorMessage error={error} />;
    if (!rows) return <p className="challenge-loading">Loading your submissions…</p>;
    if (rows.length === 0) return <p className="history-empty">No submissions yet. Submit to see your attempts here.</p>;
    return (
        <div className="reference-table history-table">
            <table>
                <thead>
                    <tr>
                        <th scope="col">Attempt</th><th scope="col">Verdict</th><th scope="col">Tests</th>
                        <th scope="col">Performance</th><th scope="col">Medal</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.id}>
                            <th scope="row">
                                <a href={`#/submissions/${row.id}`}>#{row.id}</a>
                                <span className="history-time">{relativeTime(row.created_at)}</span>
                            </th>
                            <td><VerdictText submission={row} /></td>
                            <td>{row.total ? `${row.passed}/${row.total}` : "—"}</td>
                            <td className="history-metrics">{metricsText(row)}</td>
                            <td>{row.medal ? <MedalBadge medal={row.medal}>{medalLabel(row.medal)}</MedalBadge> : "—"}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function ChallengeWorkspace({
    slug, tab = "description", user, formats, theme, onThemeChange, hasUnsavedCode, onOpenInVisualizer,
}) {
    const [problem, setProblem] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [code, setCode] = useState("");
    const [running, setRunning] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [response, setResponse] = useState(null);
    const [requestError, setRequestError] = useState(null);
    const [localProgress, setLocalProgress] = useState(() => loadProgress(slug));
    const [serverProgress, setServerProgress] = useState(null);
    const [pendingOpen, setPendingOpen] = useState(null);
    const [confirmReset, setConfirmReset] = useState(false);
    // Back from signing in to submit: say the code is still here.
    const [returning] = useState(() => returningTo(slug));
    const [welcomeDismissed, setWelcomeDismissed] = useState(false);
    const opener = useRef(null);
    const resetButton = useRef(null);
    const request = useRef(null);
    const edited = useRef(false);
    const syncTimer = useRef(null);
    const syncedFor = useRef(null);
    const signedIn = Boolean(user);
    const progress = signedIn
        ? (serverProgress?.userId === user.id ? serverProgress.entry : NO_PROGRESS)
        : localProgress;
    const welcome = returning && signedIn && !welcomeDismissed;

    useEffect(() => {
        const controller = new AbortController();
        requestJson(`/problems/${encodeURIComponent(slug)}`, { signal: controller.signal })
            .then((data) => {
                setProblem(data);
                setCode(loadDraftRecord(slug)?.code ?? data.starter);
            })
            .catch((failure) => {
                if (failure?.name !== "AbortError") setLoadError(failureFrom(failure));
            });
        return () => {
            controller.abort();
            request.current?.abort();
        };
    }, [slug]);

    // Signed in: the account's draft wins when it is newer than this
    // browser's, unless the student has already started typing here.
    useEffect(() => {
        if (!problem || !user || syncedFor.current === user.id) return undefined;
        syncedFor.current = user.id;
        const controller = new AbortController();
        accountApi.draft(slug, controller.signal).then(({ draft }) => {
            const local = loadDraftRecord(slug);
            if (draft && draft.updated_at > (local?.updatedAt ?? -1) && !edited.current) {
                setCode(draft.code);
                saveDraft(slug, draft.code, undefined, draft.updated_at);
            } else if (local && local.code !== draft?.code) {
                accountApi.saveDraft(slug, local.code).catch(() => {});
            }
        }).catch(() => {});
        return () => controller.abort();
    }, [problem, user, slug]);

    // Signed in: progress comes from the account.
    useEffect(() => {
        if (!user) return undefined;
        const controller = new AbortController();
        accountApi.progress(controller.signal)
            .then((data) => setServerProgress({ userId: user.id, entry: data.progress[slug] ?? NO_PROGRESS }))
            .catch(() => {});
        return () => controller.abort();
    }, [user, slug]);

    useEffect(() => {
        if (user && returning) forgetReturn();
    }, [user, returning]);

    useEffect(() => {
        if (problem) document.title = `${problem.title} · Challenges · Assembly Visualizer`;
    }, [problem]);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    const pushDraft = useCallback((next) => {
        clearTimeout(syncTimer.current);
        syncTimer.current = null;
        return accountApi.saveDraft(slug, next).catch(() => {});
    }, [slug]);

    useEffect(() => () => clearTimeout(syncTimer.current), []);

    function changeCode(next) {
        edited.current = true;
        setCode(next);
        saveDraft(slug, next);
        if (signedIn) {
            clearTimeout(syncTimer.current);
            syncTimer.current = setTimeout(() => pushDraft(next), DRAFT_SYNC_DELAY);
        }
    }

    async function run() {
        if (running) return;
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        setRunning(true);
        setRequestError(null);
        setResponse(null);
        try {
            const data = await requestJson(`/problems/${encodeURIComponent(slug)}/run`, {
                body: { code }, signal: controller.signal,
            });
            if (request.current !== controller) return;
            setResponse(data);
            if (!signedIn) setLocalProgress(recordAttempt(slug));
        } catch (failure) {
            if (request.current === controller && failure?.name !== "AbortError") {
                setRequestError(failureFrom(failure));
            }
        } finally {
            if (request.current === controller) {
                request.current = null;
                setRunning(false);
            }
        }
    }

    function signInToSubmit() {
        saveDraft(slug, code);
        rememberReturn(slug);
        window.location.href = loginUrl(`#/problems/${slug}`);
    }

    async function submit() {
        if (submitting) return;
        if (!signedIn) {
            signInToSubmit();
            return;
        }
        setSubmitting(true);
        setRequestError(null);
        setWelcomeDismissed(true);
        try {
            if (syncTimer.current) await pushDraft(code);
            const { id } = await accountApi.submit(slug, code);
            window.location.hash = `#/submissions/${id}`;
        } catch (failure) {
            if (failure?.loginRequired) signInToSubmit();
            else setRequestError(failureFrom(failure));
            setSubmitting(false);
        }
    }

    function open(test) {
        const program = visualizerProgram(problem, test, code);
        onOpenInVisualizer({ ...program, title: `${problem.title} · ${test.name}` });
    }

    function requestOpen(test, button) {
        opener.current = button;
        const { source } = visualizerProgram(problem, test, code);
        if (hasUnsavedCode(source)) setPendingOpen(test);
        else open(test);
    }

    function resetToStarter() {
        clearDraft(slug);
        setCode(problem.starter);
        if (signedIn) pushDraft(problem.starter);
        setConfirmReset(false);
    }

    if (loadError) {
        return <div className="challenges-page"><main className="challenges-content">
            <a className="back-link challenge-back" href="#/problems"><Icon name="back" /> All challenges</a>
            <ErrorMessage error={loadError} formats={formats} />
        </main></div>;
    }
    if (!problem) {
        return <div className="challenges-page"><main className="challenges-content">
            <p className="challenge-loading">Loading challenge…</p>
        </main></div>;
    }

    const busy = running || submitting;
    return (
        <div className="challenge-page">
            <main className="challenge-workspace" aria-label={`${problem.title} challenge`}>
                <section className="panel statement-panel" aria-labelledby="challenge-title">
                    <a className="back-link challenge-back" href="#/problems"><Icon name="back" /> All challenges</a>
                    <div className="statement-head">
                        <h1 id="challenge-title">{problem.title}</h1>
                        <p className="statement-meta">
                            <DifficultyBadge difficulty={problem.difficulty} />
                            <Tags tags={problem.tags} />
                            {progress.solved && progress.best && (
                                <span className="challenge-status status-solved">
                                    Best <MedalBadge medal={progress.best.medal}>{medalLabel(progress.best.medal)}</MedalBadge>
                                </span>
                            )}
                        </p>
                    </div>
                    <nav className="problem-tabs" aria-label="Problem">
                        <a href={`#/problems/${slug}`} aria-current={tab === "description" ? "page" : undefined}>Description</a>
                        <a href={`#/problems/${slug}/submissions`} aria-current={tab === "submissions" ? "page" : undefined}>Submissions</a>
                    </nav>
                    {tab === "submissions" ? <SubmissionHistory slug={slug} user={user} /> : <>
                        <div className="statement-body">
                            <Markdown text={problem.statement} />
                        </div>
                        <div className="statement-tests">
                            <h3>Visible tests</h3>
                            <p className="statement-limits">
                                {problem.tests.length} visible and {problem.hidden_count} hidden tests.
                                Each may run at most {problem.limits.instructions.toLocaleString("en-US")} instructions.
                            </p>
                            <ol className="visible-tests">
                                {problem.tests.map((test) => (
                                    <li key={test.id}>
                                        <div className="visible-test-head">
                                            <span className="test-name">{test.name}</span>
                                            <OpenButton test={test} onOpen={requestOpen} />
                                        </div>
                                        <TestValues test={test} />
                                    </li>
                                ))}
                            </ol>
                        </div>
                    </>}
                </section>

                <section className="panel challenge-editor-panel" aria-label="Code editor">
                    <div className="panel-head">
                        <h2>Code Editor</h2>
                        <div className="challenge-actions">
                            <button type="button" ref={resetButton} disabled={code === problem.starter || busy}
                                onClick={() => setConfirmReset(true)}>Reset</button>
                            <button type="button" disabled={busy} onClick={run}>Run</button>
                            <button type="button" className="primary" disabled={busy || user === undefined} onClick={submit}
                                title={signedIn ? undefined : "Sign in with Google to submit"}>
                                {submitting ? "Submitting…" : "Submit"}
                            </button>
                        </div>
                    </div>
                    {welcome && (
                        <p className="challenge-notice" role="status">
                            Signed in as {user.name}. Your code is just as you left it; select Submit to grade it.
                        </p>
                    )}
                    {!signedIn && user !== undefined && (
                        <p className="challenge-notice muted">Run is open to everyone. Submit asks you to sign in with Google first; your code is kept.</p>
                    )}
                    {problem.function && (
                        <p className="challenge-signature"><code>{problem.function.signature}</code></p>
                    )}
                    <CodeEditor
                        assemblyCode={code}
                        setAssemblyCode={changeCode}
                        activeLine={null}
                        darkTheme={theme === "dark"}
                        onDarkThemeChange={(dark) => onThemeChange(dark ? "dark" : "light")}
                    />
                </section>

                <section className="panel results-panel" aria-labelledby="results-heading">
                    <h2 id="results-heading">Run results</h2>
                    <RunResults response={response} busy={running} error={requestError} onOpen={requestOpen} formats={formats} />
                </section>
            </main>

            {pendingOpen && (
                <ReplaceCodeDialog
                    title={`${problem.title} · ${pendingOpen.name}`}
                    returnFocusRef={opener}
                    onCancel={() => setPendingOpen(null)}
                    onConfirm={() => {
                        const test = pendingOpen;
                        opener.current = null;
                        setPendingOpen(null);
                        open(test);
                    }}
                />
            )}
            {confirmReset && (
                <ResetDialog onCancel={() => setConfirmReset(false)} onConfirm={resetToStarter} returnFocusRef={resetButton} />
            )}
        </div>
    );
}

function ResetDialog({ onConfirm, onCancel, returnFocusRef }) {
    const dialog = useRef(null);
    const cancel = useRef(null);

    useEffect(() => {
        const element = dialog.current;
        const opener = returnFocusRef?.current;
        element.showModal();
        cancel.current.focus();
        return () => {
            element.close();
            if (opener?.isConnected) opener.focus();
        };
    }, [returnFocusRef]);

    return (
        <dialog className="confirm-dialog" ref={dialog} aria-labelledby="reset-title" aria-describedby="reset-description"
            onCancel={(event) => { event.preventDefault(); onCancel(); }}>
            <h2 id="reset-title">Reset to the starter code?</h2>
            <p id="reset-description">Your code for this challenge is replaced by the starter code. Your best result is kept.</p>
            <div className="confirm-actions">
                <button type="button" ref={cancel} onClick={onCancel}>Keep my code</button>
                <button type="button" className="danger" onClick={onConfirm}>Reset code</button>
            </div>
        </dialog>
    );
}
