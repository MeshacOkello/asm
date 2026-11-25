import { useEffect, useRef, useState } from "react";
import CodeEditor from "./CodeEditor";
import ErrorMessage from "./ErrorMessage";
import Icon from "./Icon";
import Markdown from "./Markdown";
import ReplaceCodeDialog from "./ReplaceCodeDialog";
import { DifficultyBadge, MedalBadge, Tags } from "./ChallengeList";
import { ChallengeRequestError, requestJson, visualizerProgram } from "../challenges/problems";
import { clearDraft, loadDraft, loadProgress, recordAttempt, recordSubmission, saveDraft } from "../challenges/storage";
import { MEDALS, medalLabel, medalThresholds, resultHeadline, scoreRows } from "../challenges/scoring";
import { fromClient, fromResponse } from "../errors";
import "../challenges/challenges.css";

function failureFrom(error) {
    return error instanceof ChallengeRequestError ? error.error : fromClient(error);
}

// Text that may be empty or end in a newline, shown so both are visible.
function ShownText({ text }) {
    if (text == null) return <span className="test-none">—</span>;
    if (text === "") return <span className="test-none">(empty)</span>;
    return <pre className="test-text">{text}</pre>;
}

function TestValues({ test, actual }) {
    return (
        <dl className="test-values">
            <div><dt>Input</dt><dd><ShownText text={test.input_text} /></dd></div>
            <div><dt>Expected</dt><dd><ShownText text={test.expected_text} /></dd></div>
            {actual !== undefined && <div><dt>Actual</dt><dd><ShownText text={actual} /></dd></div>}
        </dl>
    );
}

function OpenButton({ test, onOpen }) {
    return (
        <button type="button" className="open-test" onClick={(event) => onOpen(test, event.currentTarget)}>
            <Icon name="open" /> Open in visualizer
        </button>
    );
}

function ScoreCard({ score, graderMain }) {
    const rows = scoreRows(score);
    const thresholds = medalThresholds(score.reference);
    return (
        <div className="score-card">
            <p className="score-medal">
                <MedalBadge medal={score.medal}>{medalLabel(score.medal)}</MedalBadge>
                <span>{MEDALS[score.medal]?.rule}.</span>
            </p>
            <table className="score-table">
                <thead>
                    <tr><th scope="col">Over all tests</th><th scope="col">Yours</th><th scope="col">Reference</th><th scope="col">Difference</th></tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.key}>
                            <th scope="row">{row.label}</th>
                            <td>{row.yours.toLocaleString("en-US")}</td>
                            <td>{row.reference.toLocaleString("en-US")}</td>
                            <td className={row.comparison.better ? "score-better" : "score-worse"}>{row.comparison.text}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="score-hint">
                Gold: at most {thresholds.gold.instructions.toLocaleString("en-US")} instructions
                and {thresholds.gold.memory_accesses.toLocaleString("en-US")} memory accesses.
                Silver: at most {thresholds.silver.instructions.toLocaleString("en-US")} and {thresholds.silver.memory_accesses.toLocaleString("en-US")}.
                {graderMain ? " Only your code is counted, not the grader’s main." : " Library calls count as one instruction each."}
            </p>
        </div>
    );
}

function ResultRow({ result, onOpen, formats }) {
    return (
        <li className={`test-result ${result.passed ? "test-passed" : "test-failed"}`}>
            <div className="test-result-head">
                <span className="test-mark" aria-hidden="true">{result.passed ? "✓" : "✗"}</span>
                <span className="test-name">{result.name}</span>
                <span className="test-kind">{result.passed ? "Passed" : result.kind_label}</span>
                {result.visible && result.instructions > 0 && (
                    <span className="test-counts">
                        {result.instructions.toLocaleString("en-US")} instr · {result.memory_accesses.toLocaleString("en-US")} mem
                    </span>
                )}
                {result.visible && <OpenButton test={result} onOpen={onOpen} />}
            </div>
            {result.visible && <>
                <TestValues test={result} actual={result.actual_text} />
                {result.error
                    ? <ErrorMessage error={fromResponse({ error_info: result.error })} formats={formats} />
                    : result.message && !result.passed && <p className="test-message">{result.message}</p>}
            </>}
        </li>
    );
}

function Results({ response, busy, error, onOpen, formats, graderMain }) {
    if (busy) {
        return <p className="results-empty" role="status">
            {busy === "submit" ? "Running every test…" : "Running the visible tests…"}
        </p>;
    }
    if (error) return <ErrorMessage error={error} formats={formats} />;
    if (!response) {
        return <p className="results-empty">
            Run checks your code against the visible tests. Submit runs every test, hidden ones included,
            and scores an accepted solution.
        </p>;
    }
    const headline = resultHeadline(response);
    return (
        <div className="results-body">
            <p className={`results-headline ${headline.accepted ? "verdict-accepted" : "verdict-failed"}`} role="status">
                <strong>{headline.verdict}</strong>
                <span>{headline.counts}{response.mode === "run" ? " · Submit to run the hidden tests" : ""}</span>
            </p>
            {response.score && <ScoreCard score={response.score} graderMain={graderMain} />}
            <ol className="test-results">
                {response.results.map((result) => (
                    <ResultRow key={result.name} result={result} onOpen={onOpen} formats={formats} />
                ))}
            </ol>
        </div>
    );
}

export default function ChallengeWorkspace({ slug, formats, theme, onThemeChange, hasUnsavedCode, onOpenInVisualizer }) {
    const [problem, setProblem] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(null);
    const [response, setResponse] = useState(null);
    const [requestError, setRequestError] = useState(null);
    const [progress, setProgress] = useState(() => loadProgress(slug));
    const [pendingOpen, setPendingOpen] = useState(null);
    const [confirmReset, setConfirmReset] = useState(false);
    const opener = useRef(null);
    const resetButton = useRef(null);
    const request = useRef(null);

    useEffect(() => {
        const controller = new AbortController();
        requestJson(`/problems/${encodeURIComponent(slug)}`, { signal: controller.signal })
            .then((data) => {
                setProblem(data);
                setCode(loadDraft(slug) ?? data.starter);
            })
            .catch((failure) => {
                if (failure?.name !== "AbortError") setLoadError(failureFrom(failure));
            });
        return () => {
            controller.abort();
            request.current?.abort();
        };
    }, [slug]);

    useEffect(() => {
        if (problem) document.title = `${problem.title} · Challenges · Assembly Visualizer`;
    }, [problem]);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    function changeCode(next) {
        setCode(next);
        saveDraft(slug, next);
    }

    async function grade(mode) {
        if (busy) return;
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        setBusy(mode);
        setRequestError(null);
        setResponse(null);
        try {
            const data = await requestJson(`/problems/${encodeURIComponent(slug)}/${mode}`, {
                body: { code }, signal: controller.signal,
            });
            if (request.current !== controller) return;
            setResponse(data);
            setProgress(mode === "submit" ? recordSubmission(slug, data) : recordAttempt(slug));
        } catch (failure) {
            if (request.current === controller && failure?.name !== "AbortError") {
                setRequestError(failureFrom(failure));
            }
        } finally {
            if (request.current === controller) {
                request.current = null;
                setBusy(null);
            }
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
                </section>

                <section className="panel challenge-editor-panel" aria-label="Code editor">
                    <div className="panel-head">
                        <h2>Code Editor</h2>
                        <div className="challenge-actions">
                            <button type="button" ref={resetButton} disabled={code === problem.starter || busy !== null}
                                onClick={() => setConfirmReset(true)}>Reset</button>
                            <button type="button" disabled={busy !== null} onClick={() => grade("run")}>Run</button>
                            <button type="button" className="primary" disabled={busy !== null} onClick={() => grade("submit")}>Submit</button>
                        </div>
                    </div>
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
                    <h2 id="results-heading">Results</h2>
                    <Results response={response} busy={busy} error={requestError} onOpen={requestOpen} formats={formats}
                        graderMain={Boolean(problem.function)} />
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
