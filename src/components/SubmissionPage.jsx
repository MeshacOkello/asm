import { useEffect, useMemo, useRef, useState } from "react";
import ErrorMessage from "./ErrorMessage";
import Icon from "./Icon";
import ReplaceCodeDialog from "./ReplaceCodeDialog";
import { DifficultyBadge } from "./ChallengeList";
import { CodeView, ResultList, ScoreCard } from "./ChallengeResults";
import { accountApi, loginUrl } from "../account";
import { failureFrom, visualizerProgram } from "../challenges/problems";
import { saveDraft } from "../challenges/storage";
import { diffStats, lineDiff } from "../challenges/diff";
import { attemptLabel, formatTimestamp, isJudging, visualizerTest } from "../challenges/submissions";
import "../challenges/challenges.css";

const POLL_INTERVAL = 700;

function DiffView({ before, after }) {
    const diff = useMemo(() => lineDiff(before, after), [before, after]);
    const stats = diffStats(diff);
    if (stats.added === 0 && stats.removed === 0) {
        return <p className="diff-same">The code is identical to that attempt.</p>;
    }
    return (
        <>
            <p className="diff-stats"><span className="diff-added-count">+{stats.added}</span> <span className="diff-removed-count">−{stats.removed}</span> lines</p>
            <pre className="code-block diff-view" tabIndex={0} aria-label="Changes since the selected attempt">
                <code>
                    {diff.map((line, index) => (
                        <span key={index} className={`diff-line diff-${line.type}`}>
                            <span className="code-line-number">{line.before ?? ""}</span>
                            <span className="code-line-number">{line.after ?? ""}</span>
                            <span className="diff-sign" aria-hidden="true">{line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}</span>
                            <span className="visually-hidden">{line.type === "added" ? "Added: " : line.type === "removed" ? "Removed: " : ""}</span>
                            <span className="code-line-text">{line.text || " "}</span>
                        </span>
                    ))}
                </code>
            </pre>
        </>
    );
}

function Compare({ submission }) {
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState(submission.earlier[0]?.id ?? null);
    const [codes, setCodes] = useState({});
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!open || selected == null || codes[selected] !== undefined) return undefined;
        const controller = new AbortController();
        accountApi.submission(selected, controller.signal)
            .then((data) => setCodes((current) => ({ ...current, [selected]: data.code })))
            .catch((failure) => {
                if (failure?.name !== "AbortError") setError(failureFrom(failure));
            });
        return () => controller.abort();
    }, [open, selected, codes]);

    if (submission.earlier.length === 0) {
        return <p className="compare-none">This is your first attempt at this problem, so there is nothing to compare with yet.</p>;
    }
    if (!open) {
        return <button type="button" onClick={() => setOpen(true)}>Compare with previous attempt</button>;
    }
    return (
        <div className="compare-panel">
            <div className="compare-head">
                <label>
                    Compare with
                    <select value={selected ?? ""} onChange={(event) => setSelected(Number(event.target.value))}>
                        {submission.earlier.map((attempt, index) => (
                            <option key={attempt.id} value={attempt.id}>
                                {index === 0 ? "Previous: " : ""}{attemptLabel(attempt)}
                            </option>
                        ))}
                    </select>
                </label>
                <button type="button" onClick={() => setOpen(false)}>Hide comparison</button>
            </div>
            {error && <ErrorMessage error={error} />}
            {codes[selected] === undefined && !error
                ? <p className="challenge-loading">Loading that attempt…</p>
                : codes[selected] !== undefined && <DiffView before={codes[selected]} after={submission.code} />}
        </div>
    );
}

export default function SubmissionPage({ id, user, formats, hasUnsavedCode, onOpenInVisualizer }) {
    const [submission, setSubmission] = useState(null);
    const [error, setError] = useState(null);
    const [pendingOpen, setPendingOpen] = useState(null);
    const opener = useRef(null);

    useEffect(() => {
        if (!user) return undefined;
        let timer = null;
        let stopped = false;
        const controller = new AbortController();
        async function load() {
            try {
                const data = await accountApi.submission(id, controller.signal);
                if (stopped) return;
                setSubmission(data);
                if (isJudging(data)) timer = setTimeout(load, POLL_INTERVAL);
            } catch (failure) {
                if (!stopped && failure?.name !== "AbortError") setError(failureFrom(failure));
            }
        }
        load();
        return () => {
            stopped = true;
            clearTimeout(timer);
            controller.abort();
        };
    }, [id, user]);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [id]);

    useEffect(() => {
        if (submission) document.title = `Submission #${submission.id} · ${submission.title} · Assembly Visualizer`;
    }, [submission]);

    if (user === null) {
        return <div className="challenges-page"><main className="challenges-content">
            <h1>Submission</h1>
            <p className="challenges-lede">Submissions are private. Sign in to see yours.</p>
            <p><a className="button-link primary" href={loginUrl(`#/submissions/${id}`)}>Sign in with Google</a></p>
        </main></div>;
    }
    if (error) {
        return <div className="challenges-page"><main className="challenges-content">
            <a className="back-link challenge-back" href="#/problems"><Icon name="back" /> All challenges</a>
            <ErrorMessage error={error} formats={formats} />
        </main></div>;
    }
    if (!submission) {
        return <div className="challenges-page"><main className="challenges-content">
            <p className="challenge-loading">Loading submission…</p>
        </main></div>;
    }

    const judging = isJudging(submission);
    const accepted = submission.verdict === "accepted";
    const graderMain = submission.results.some((result) => result.harness);
    const openTest = visualizerTest(submission.results);

    function open(test) {
        const program = visualizerProgram(null, test, submission.code);
        onOpenInVisualizer({ ...program, title: `${submission.title} · Submission #${submission.id} · ${test.name}` });
    }

    function requestOpen(test, button) {
        opener.current = button;
        const { source } = visualizerProgram(null, test, submission.code);
        if (hasUnsavedCode(source)) setPendingOpen(test);
        else open(test);
    }

    function editAndResubmit() {
        saveDraft(submission.slug, submission.code);
        accountApi.saveDraft(submission.slug, submission.code).catch(() => {});
        window.location.hash = `#/problems/${submission.slug}`;
    }

    const failed = submission.first_failure != null ? submission.results[submission.first_failure] : null;

    return (
        <div className="challenges-page">
            <main className="challenges-content submission-page" aria-labelledby="submission-title">
                <a className="back-link challenge-back" href={`#/problems/${submission.slug}`}>
                    <Icon name="back" /> Back to {submission.title}
                </a>

                <header className="submission-head">
                    <div>
                        <p className="submission-kicker">
                            Submission #{submission.id} · <a href={`#/problems/${submission.slug}`}>{submission.title}</a>{" "}
                            <DifficultyBadge difficulty={submission.difficulty} />
                        </p>
                        <h1 id="submission-title" className={`submission-verdict submission-verdict-${judging ? "judging" : accepted ? "accepted" : "failed"}`}
                            aria-live="polite">
                            {judging ? <><span className="judging-spinner" aria-hidden="true" />Judging…</> : submission.verdict_label}
                        </h1>
                        <p className="submission-meta">
                            {judging
                                ? "Running every test, hidden ones included. This page updates by itself."
                                : <>{submission.passed} of {submission.total} tests passed · Submitted {formatTimestamp(submission.created_at)}</>}
                        </p>
                    </div>
                    <div className="submission-actions">
                        <a className="button-link" href={`#/problems/${submission.slug}`}>Back to problem</a>
                        <button type="button" disabled={judging || !openTest}
                            onClick={(event) => openTest && requestOpen(openTest, event.currentTarget)}>
                            <Icon name="open" /> Open in visualizer
                        </button>
                        <button type="button" className="primary" onClick={editAndResubmit}>Edit and resubmit</button>
                    </div>
                </header>

                {!judging && submission.status === "error" && (
                    <ErrorMessage error={{ kind: "internal", message: "The grader failed on this submission.",
                        parts: null, line: null, sourceLine: null,
                        suggestion: "Submit again. If it keeps happening, the problem is in the simulator, not your code.",
                        detail: null }} formats={formats} />
                )}

                {!judging && accepted && submission.score && (
                    <section className="submission-section" aria-labelledby="performance-heading">
                        <h2 id="performance-heading">Performance</h2>
                        <ScoreCard score={submission.score} ranking={submission.ranking} graderMain={graderMain} />
                    </section>
                )}

                {!judging && failed && (
                    <section className="submission-section" aria-labelledby="first-failure-heading">
                        <h2 id="first-failure-heading">First failing test</h2>
                        <ResultList results={[failed]} onOpen={requestOpen} formats={formats} />
                    </section>
                )}

                {!judging && submission.results.length > 0 && (
                    <section className="submission-section" aria-labelledby="tests-heading">
                        <h2 id="tests-heading">All tests</h2>
                        <ResultList results={submission.results} onOpen={requestOpen} formats={formats}
                            firstFailure={submission.first_failure} />
                    </section>
                )}

                <section className="submission-section" aria-labelledby="code-heading">
                    <h2 id="code-heading">Submitted code</h2>
                    <CodeView code={submission.code} />
                    <Compare key={submission.id} submission={submission} />
                </section>
            </main>

            {pendingOpen && (
                <ReplaceCodeDialog
                    title={`${submission.title} · ${pendingOpen.name}`}
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
        </div>
    );
}
