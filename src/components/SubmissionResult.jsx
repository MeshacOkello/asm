import { useEffect, useState } from "react";
import ErrorMessage from "./ErrorMessage";
import Icon from "./Icon";
import { CasePills, CaseView, CodeView, DiffView, OpenButton, Performance } from "./ChallengeResults";
import { accountApi, loginUrl } from "../account";
import { failureFrom } from "../challenges/problems";
import { attemptLabel, formatTimestamp, isJudging, visualizerTest } from "../challenges/submissions";

const POLL_INTERVAL = 700;

// The submitted code, or its changes since an earlier attempt: the one just
// before by default, or any earlier one picked from the list.
function CodeSection({ submission }) {
    const [against, setAgainst] = useState(null);
    const [codes, setCodes] = useState({});
    const [error, setError] = useState(null);

    useEffect(() => {
        if (against == null || codes[against] !== undefined) return undefined;
        const controller = new AbortController();
        accountApi.submission(against, controller.signal)
            .then((data) => setCodes((current) => ({ ...current, [against]: data.code })))
            .catch((failure) => {
                if (failure?.name !== "AbortError") setError(failureFrom(failure));
            });
        return () => controller.abort();
    }, [against, codes]);

    const earlier = submission.earlier;
    return (
        <section className="result-code" aria-label="Submitted code">
            <div className="result-code-head">
                <h3>Code <span>AArch64</span></h3>
                {earlier.length > 0 && (against == null
                    ? <button type="button" className="quiet-button" onClick={() => setAgainst(earlier[0].id)}>Compare with previous attempt</button>
                    : <div className="compare-controls">
                        <label>
                            <span className="visually-hidden">Compare with</span>
                            <select value={against} onChange={(event) => setAgainst(Number(event.target.value))}>
                                {earlier.map((attempt, index) => (
                                    <option key={attempt.id} value={attempt.id}>
                                        {index === 0 ? "Previous: " : ""}{attemptLabel(attempt)}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <button type="button" className="quiet-button" onClick={() => setAgainst(null)}>Done</button>
                    </div>)}
            </div>
            {against == null && <CodeView code={submission.code} />}
            {against != null && error && <ErrorMessage error={error} />}
            {against != null && !error && (codes[against] === undefined
                ? <p className="challenge-loading">Loading that attempt…</p>
                : <DiffView before={codes[against]} after={submission.code} />)}
        </section>
    );
}

export default function SubmissionResult({ id, user, problem, formats, onOpen, onEditAndResubmit }) {
    const [submission, setSubmission] = useState(null);
    const [error, setError] = useState(null);
    const [chosen, setChosen] = useState(null);

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

    if (user === null) {
        return <div className="result-empty">
            <p>Submissions are private. Sign in to see yours.</p>
            <a className="button-link primary" href={loginUrl(window.location.hash)}>Sign in with Google</a>
        </div>;
    }
    if (error) return <ErrorMessage error={error} formats={formats} />;
    if (!submission) return <p className="challenge-loading">Loading submission…</p>;

    const back = <a className="result-back" href={`#/problems/${submission.slug}/submissions`}><Icon name="back" size={15} /> All submissions</a>;
    if (isJudging(submission)) {
        return <div className="submission-result">
            {back}
            <h2 className="result-verdict" aria-live="polite"><span className="judging-spinner" aria-hidden="true" /> Judging…</h2>
            <p className="result-meta">Running every test, hidden ones included. This updates by itself.</p>
        </div>;
    }

    const accepted = submission.verdict === "accepted";
    const results = submission.results;
    const visible = results.filter((result) => result.visible);
    const focus = chosen ?? (submission.first_failure != null && results[submission.first_failure]?.visible
        ? results[submission.first_failure] : visualizerTest(results));
    const graderMain = results.some((result) => result.harness);
    const firstHidden = submission.first_failure != null && !results[submission.first_failure].visible
        ? results[submission.first_failure] : null;
    const open = (test, button) => onOpen(test, button, submission.code);

    return (
        <div className="submission-result">
            {back}
            <div className="result-head">
                <div>
                    <h2 className={`result-verdict ${accepted ? "verdict-text-accepted" : "verdict-text-failed"}`}>
                        {submission.status === "error" ? "Grading failed" : submission.verdict_label}
                        <span className="result-count">{submission.passed} / {submission.total} testcases passed</span>
                    </h2>
                    <p className="result-meta">
                        {user?.name} submitted at {formatTimestamp(submission.created_at)}
                    </p>
                </div>
                <div className="result-actions">
                    <OpenButton test={accepted ? visualizerTest(results) : focus ?? visualizerTest(results)} onOpen={open}
                        label={accepted || !focus ? "Open in visualizer" : `Open ${focus.name.replace("Test ", "case ")} in visualizer`} />
                    <button type="button" className="primary" onClick={() => onEditAndResubmit(submission.code)}>Edit and resubmit</button>
                </div>
            </div>

            {submission.status === "error" && (
                <ErrorMessage error={{ kind: "internal", message: "The grader failed on this submission.",
                    parts: null, line: null, sourceLine: null,
                    suggestion: "Submit again. If it keeps happening, the problem is in the simulator, not your code.",
                    detail: null }} formats={formats} />
            )}

            {accepted && submission.score && (
                <Performance score={submission.score} ranking={submission.ranking} graderMain={graderMain} />
            )}

            {!accepted && results.length > 0 && (
                <section className="result-tests" aria-label="Test results">
                    {firstHidden && (
                        <p className="hidden-failure">
                            <strong>{firstHidden.name}</strong> failed: {firstHidden.kind_label}. Hidden tests show only why they failed.
                        </p>
                    )}
                    {visible.length > 0 && <>
                        <CasePills
                            label="Visible tests"
                            cases={visible.map((result, position) => ({ key: result.name, label: `Case ${position + 1}`, passed: result.passed }))}
                            selected={Math.max(0, visible.indexOf(focus))}
                            onSelect={(index) => setChosen(visible[index])} />
                        {focus && <CaseView problem={problem} test={focus} result={focus} formats={formats} />}
                    </>}
                    <ul className="test-strip" aria-label="Every test">
                        {results.map((result) => (
                            <li key={result.name} className={result.passed ? "strip-passed" : "strip-failed"}
                                title={result.passed ? `${result.name} passed` : `${result.name}: ${result.kind_label}`}>
                                <span aria-hidden="true">{result.passed ? "✓" : "✗"}</span> {result.visible ? result.name.replace("Test ", "Case ") : result.name.replace("Hidden test ", "Hidden ")}
                                {!result.passed && <span className="strip-kind">{result.kind_label}</span>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <CodeSection key={submission.id} submission={submission} />
        </div>
    );
}
