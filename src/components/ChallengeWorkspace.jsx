import { useCallback, useEffect, useRef, useState } from "react";
import CodeEditor from "./CodeEditor";
import ErrorMessage from "./ErrorMessage";
import Icon from "./Icon";
import Markdown from "./Markdown";
import ReplaceCodeDialog from "./ReplaceCodeDialog";
import SubmissionResult from "./SubmissionResult";
import TestConsole from "./TestConsole";
import { MedalBadge, Tags } from "./ChallengeList";
import { failureFrom, difficultyLabel, requestJson, visualizerProgram } from "../challenges/problems";
import { clearDraft, loadDraftRecord, loadProgress, recordAttempt, saveDraft } from "../challenges/storage";
import { medalLabel } from "../challenges/scoring";
import { relativeTime } from "../challenges/submissions";
import { accountApi, loginUrl } from "../account";
import "../challenges/challenges.css";

// Remembers, across the trip to Google, which problem was being submitted.
const RETURN_KEY = "assembly-visualizer-submit-after-login";
const DRAFT_SYNC_DELAY = 800;
const NO_PROGRESS = Object.freeze({ attempted: false, solved: false, best: null });

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

export function VerdictText({ submission }) {
    const tone = submission.status === "judging" ? "judging"
        : submission.verdict === "accepted" ? "accepted" : "failed";
    return <span className={`verdict-text verdict-text-${tone}`}>{submission.verdict_label}</span>;
}

export function DifficultyChip({ difficulty }) {
    return <span className={`difficulty-chip difficulty-chip-${difficulty}`}>{difficultyLabel(difficulty)}</span>;
}

function Description({ problem, progress }) {
    return (
        <article className="problem-description">
            <header className="description-head">
                <h1 id="challenge-title">{problem.title}</h1>
                {progress.solved && (
                    <span className="solved-mark">
                        Solved <Icon name="check" size={15} />
                        {progress.best && <MedalBadge medal={progress.best.medal}>{medalLabel(progress.best.medal)}</MedalBadge>}
                    </span>
                )}
            </header>
            <p className="description-meta">
                <DifficultyChip difficulty={problem.difficulty} />
                <Tags tags={problem.tags} />
            </p>
            <div className="statement-body">
                <Markdown text={problem.statement} />
            </div>
            <p className="description-limits">
                {problem.tests.length} visible and {problem.hidden_count} hidden tests · each may run at most{" "}
                {problem.limits.instructions.toLocaleString("en-US")} instructions
            </p>
        </article>
    );
}

function SubmissionHistory({ slug, user }) {
    const [state, setState] = useState({ for: null, rows: null, error: null });

    useEffect(() => {
        if (!user) return undefined;
        const controller = new AbortController();
        accountApi.history(slug, controller.signal)
            .then((data) => setState({ for: user.id, rows: data.submissions, error: null }))
            .catch((failure) => {
                if (failure?.name !== "AbortError") setState({ for: user.id, rows: null, error: failureFrom(failure) });
            });
        return () => controller.abort();
    }, [slug, user]);

    if (!user) {
        return <div className="result-empty">
            <p>Sign in to submit solutions and keep a history of your attempts.</p>
            <a className="button-link primary" href={loginUrl(`#/problems/${slug}/submissions`)}>Sign in with Google</a>
        </div>;
    }
    const { rows, error } = state.for === user.id ? state : { rows: null, error: null };
    if (error) return <ErrorMessage error={error} />;
    if (!rows) return <p className="challenge-loading">Loading your submissions…</p>;
    if (rows.length === 0) return <p className="result-empty">No submissions yet. Submit to see your attempts here.</p>;
    return (
        <div className="submission-list" role="table" aria-label="Your submissions">
            <div className="submission-row submission-row-head" role="row">
                <span role="columnheader">Status</span>
                <span role="columnheader">Instructions</span>
                <span role="columnheader">Memory</span>
                <span role="columnheader">Medal</span>
            </div>
            {rows.map((row) => (
                <a key={row.id} className="submission-row" role="row" href={`#/problems/${slug}/submissions/${row.id}`}>
                    <span role="cell" className="submission-status">
                        <VerdictText submission={row} />
                        <span className="submission-when">{relativeTime(row.created_at)} · #{row.id}{row.total ? ` · ${row.passed}/${row.total}` : ""}</span>
                    </span>
                    <span role="cell" className="submission-metric">{row.instructions == null ? "—" : row.instructions.toLocaleString("en-US")}</span>
                    <span role="cell" className="submission-metric">{row.memory_accesses == null ? "—" : row.memory_accesses.toLocaleString("en-US")}</span>
                    <span role="cell">{row.medal ? <MedalBadge medal={row.medal}>{medalLabel(row.medal)}</MedalBadge> : ""}</span>
                </a>
            ))}
        </div>
    );
}

export default function ChallengeWorkspace({
    slug, tab = "description", submissionId = null, user, formats, theme, onThemeChange,
    hasUnsavedCode, onOpenInVisualizer,
}) {
    const [problem, setProblem] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [code, setCode] = useState("");
    const [running, setRunning] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [run, setRun] = useState(null);
    const [runError, setRunError] = useState(null);
    const [submitError, setSubmitError] = useState(null);
    const [consoleView, setConsoleView] = useState("cases");
    const [localProgress, setLocalProgress] = useState(() => loadProgress(slug));
    const [serverProgress, setServerProgress] = useState(null);
    const [pendingOpen, setPendingOpen] = useState(null);
    const [pendingCode, setPendingCode] = useState(null);
    const [confirmReset, setConfirmReset] = useState(false);
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

    // Signed in: progress comes from the account, and refreshes after a result.
    useEffect(() => {
        if (!user) return undefined;
        const controller = new AbortController();
        accountApi.progress(controller.signal)
            .then((data) => setServerProgress({ userId: user.id, entry: data.progress[slug] ?? NO_PROGRESS }))
            .catch(() => {});
        return () => controller.abort();
    }, [user, slug, submissionId]);

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

    function setEditorCode(next) {
        edited.current = true;
        setCode(next);
        saveDraft(slug, next);
        if (signedIn) {
            clearTimeout(syncTimer.current);
            syncTimer.current = setTimeout(() => pushDraft(next), DRAFT_SYNC_DELAY);
        }
    }

    async function runCode() {
        if (running) return;
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        setRunning(true);
        setRunError(null);
        setConsoleView("result");
        try {
            const data = await requestJson(`/problems/${encodeURIComponent(slug)}/run`, {
                body: { code }, signal: controller.signal,
            });
            if (request.current !== controller) return;
            setRun({ ...data, code });
            if (!signedIn) setLocalProgress(recordAttempt(slug));
        } catch (failure) {
            if (request.current === controller && failure?.name !== "AbortError") setRunError(failureFrom(failure));
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
        setSubmitError(null);
        setWelcomeDismissed(true);
        try {
            if (syncTimer.current) await pushDraft(code);
            const { id } = await accountApi.submit(slug, code);
            window.location.hash = `#/problems/${slug}/submissions/${id}`;
        } catch (failure) {
            if (failure?.loginRequired) signInToSubmit();
            else setSubmitError(failureFrom(failure));
        } finally {
            setSubmitting(false);
        }
    }

    // A case runs in the visualizer with the code that produced it: the
    // editor's for Run and the test cases, the submission's for a result.
    function open(test, source = code) {
        const program = visualizerProgram(problem, test, source);
        onOpenInVisualizer({ ...program, title: `${problem.title} · ${test.name.replace("Test ", "Case ")}` });
    }

    function requestOpen(test, button, source = code) {
        opener.current = button;
        const program = visualizerProgram(problem, test, source);
        if (hasUnsavedCode(program.source)) setPendingOpen({ test, source });
        else open(test, source);
    }

    function focusEditor() {
        document.querySelector(".code-pane .assembly-input")?.focus();
    }

    function editAndResubmit(submitted) {
        if (submitted === code) focusEditor();
        else setPendingCode(submitted);
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
        return <div className="challenge-page"><p className="challenge-loading">Loading challenge…</p></div>;
    }

    const busy = running || submitting;
    const leftTabs = [
        { id: "description", label: "Description", icon: "file", href: `#/problems/${slug}` },
        { id: "submissions", label: "Submissions", icon: "history", href: `#/problems/${slug}/submissions` },
    ];
    return (
        <div className="challenge-page">
            <main className="challenge-workspace" aria-label={`${problem.title} challenge`}>
                <section className="pane left-pane" aria-labelledby={tab === "description" ? "challenge-title" : undefined}
                    aria-label={tab === "description" ? undefined : problem.title}>
                    <nav className="pane-tabs" aria-label="Problem">
                        <a className="pane-tab pane-back" href="#/problems" aria-label="All challenges" title="All challenges">
                            <Icon name="back" size={15} />
                        </a>
                        {leftTabs.map((item) => (
                            <a key={item.id} className="pane-tab" href={item.href} aria-current={tab === item.id ? "page" : undefined}>
                                <Icon name={item.icon} size={15} /> {item.label}
                            </a>
                        ))}
                        {tab === "result" && (
                            <span className="pane-tab pane-tab-closable" aria-current="page">
                                <Icon name="history" size={15} /> Submission #{submissionId}
                                <a href={`#/problems/${slug}/submissions`} className="tab-close" aria-label="Close submission">
                                    <Icon name="close" size={13} />
                                </a>
                            </span>
                        )}
                    </nav>
                    <div className="pane-body">
                        {tab === "description" && <Description problem={problem} progress={progress} />}
                        {tab === "submissions" && <SubmissionHistory slug={slug} user={user} />}
                        {tab === "result" && (
                            <SubmissionResult key={submissionId} id={submissionId} user={user} problem={problem} formats={formats}
                                onOpen={requestOpen} onEditAndResubmit={editAndResubmit} />
                        )}
                    </div>
                </section>

                <section className="pane code-pane" aria-label="Code">
                    <div className="pane-tabs">
                        <span className="pane-tab" aria-current="page"><Icon name="code" size={15} /> Code</span>
                        <span className="pane-language">AArch64</span>
                        <span className="pane-tabs-spacer" />
                        <button type="button" className="icon-button" ref={resetButton} disabled={code === problem.starter || busy}
                            onClick={() => setConfirmReset(true)} aria-label="Reset to the starter code" title="Reset to the starter code">
                            <Icon name="reset" size={15} />
                        </button>
                        <button type="button" className="toolbar-button" disabled={busy} onClick={runCode}>
                            <Icon name="play" size={13} /> Run
                        </button>
                        <button type="button" className="toolbar-button primary" disabled={busy || user === undefined} onClick={submit}
                            title={signedIn ? undefined : "Sign in with Google to submit"}>
                            {submitting ? "Submitting…" : "Submit"}
                        </button>
                    </div>
                    {(welcome || submitError) && (
                        <div className="pane-notices">
                            {welcome && (
                                <p className="challenge-notice" role="status">
                                    Signed in as {user.name}. Your code is just as you left it; select Submit to grade it.
                                </p>
                            )}
                            {submitError && <ErrorMessage error={submitError} formats={formats} />}
                        </div>
                    )}
                    <CodeEditor
                        assemblyCode={code}
                        setAssemblyCode={setEditorCode}
                        activeLine={null}
                        darkTheme={theme === "dark"}
                        onDarkThemeChange={(dark) => onThemeChange(dark ? "dark" : "light")}
                    />
                </section>

                <TestConsole problem={problem} run={run} stale={run !== null && run.code !== code} running={running} error={runError}
                    view={consoleView} onViewChange={setConsoleView} onOpen={requestOpen} formats={formats} />
            </main>

            {pendingOpen && (
                <ReplaceCodeDialog
                    title={`${problem.title} · ${pendingOpen.test.name.replace("Test ", "Case ")}`}
                    returnFocusRef={opener}
                    onCancel={() => setPendingOpen(null)}
                    onConfirm={() => {
                        const { test, source } = pendingOpen;
                        opener.current = null;
                        setPendingOpen(null);
                        open(test, source);
                    }}
                />
            )}
            {pendingCode !== null && (
                <ConfirmDialog
                    title="Put this submission in the editor?"
                    text="It replaces the code in the editor, which is not part of any submission yet."
                    cancel="Keep the editor’s code" confirm="Replace editor code"
                    onCancel={() => setPendingCode(null)}
                    onConfirm={() => { setEditorCode(pendingCode); setPendingCode(null); setTimeout(focusEditor); }} />
            )}
            {confirmReset && (
                <ConfirmDialog
                    title="Reset to the starter code?"
                    text="Your code for this challenge is replaced by the starter code. Your best result is kept."
                    cancel="Keep my code" confirm="Reset code" returnFocusRef={resetButton}
                    onCancel={() => setConfirmReset(false)} onConfirm={resetToStarter} />
            )}
        </div>
    );
}

function ConfirmDialog({ title, text, cancel: cancelText, confirm, onConfirm, onCancel, returnFocusRef }) {
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
        <dialog className="confirm-dialog" ref={dialog} aria-labelledby="confirm-title" aria-describedby="confirm-description"
            onCancel={(event) => { event.preventDefault(); onCancel(); }}>
            <h2 id="confirm-title">{title}</h2>
            <p id="confirm-description">{text}</p>
            <div className="confirm-actions">
                <button type="button" ref={cancel} onClick={onCancel}>{cancelText}</button>
                <button type="button" className="danger" onClick={onConfirm}>{confirm}</button>
            </div>
        </dialog>
    );
}
