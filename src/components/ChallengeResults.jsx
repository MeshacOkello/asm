// The pieces that show grading results, shared by the workspace's Run panel
// and the submission page: test rows, the score card and the rankings.
import ErrorMessage from "./ErrorMessage";
import Icon from "./Icon";
import { MedalBadge } from "./ChallengeList";
import { MEDALS, medalLabel, medalThresholds, scoreRows } from "../challenges/scoring";
import { rankingRows } from "../challenges/submissions";
import { fromResponse } from "../errors";

// Text that may be empty or end in a newline, shown so both are visible.
function ShownText({ text }) {
    if (text == null) return <span className="test-none">—</span>;
    if (text === "") return <span className="test-none">(empty)</span>;
    return <pre className="test-text">{text}</pre>;
}

export function TestValues({ test, actual }) {
    return (
        <dl className="test-values">
            <div><dt>Input</dt><dd><ShownText text={test.input_text} /></dd></div>
            <div><dt>Expected</dt><dd><ShownText text={test.expected_text} /></dd></div>
            {actual !== undefined && <div><dt>Actual</dt><dd><ShownText text={actual} /></dd></div>}
        </dl>
    );
}

export function OpenButton({ test, onOpen }) {
    return (
        <button type="button" className="open-test" onClick={(event) => onOpen(test, event.currentTarget)}>
            <Icon name="open" /> Open in visualizer
        </button>
    );
}

function ScoreHint({ reference, graderMain }) {
    const thresholds = medalThresholds(reference);
    return (
        <p className="score-hint">
            Gold: at most {thresholds.gold.instructions.toLocaleString("en-US")} instructions
            and {thresholds.gold.memory_accesses.toLocaleString("en-US")} memory accesses.
            Silver: at most {thresholds.silver.instructions.toLocaleString("en-US")} and {thresholds.silver.memory_accesses.toLocaleString("en-US")}.
            {graderMain ? " Only your code is counted, not the grader’s main." : " Library calls count as one instruction each."}
        </p>
    );
}

// An accepted submission's totals: against other students once enough have
// solved the problem, otherwise against the reference solution.
export function ScoreCard({ score, ranking = null, graderMain }) {
    const ranks = rankingRows(ranking);
    return (
        <div className="score-card">
            <p className="score-medal">
                <MedalBadge medal={score.medal}>{medalLabel(score.medal)}</MedalBadge>
                <span>{MEDALS[score.medal]?.rule}.</span>
            </p>
            {ranks ? (
                <table className="score-table">
                    <thead>
                        <tr><th scope="col">Over all tests</th><th scope="col">Yours</th><th scope="col">Against {ranking.compared} other students</th></tr>
                    </thead>
                    <tbody>
                        {ranks.map((row) => (
                            <tr key={row.key}>
                                <th scope="row">{row.label}</th>
                                <td>{score[row.key].toLocaleString("en-US")}</td>
                                <td>
                                    <span className="rank-bar" aria-hidden="true"><span style={{ width: `${row.beats}%` }} /></span>
                                    {row.text}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : (
                <table className="score-table">
                    <thead>
                        <tr><th scope="col">Over all tests</th><th scope="col">Yours</th><th scope="col">Reference</th><th scope="col">Difference</th></tr>
                    </thead>
                    <tbody>
                        {scoreRows(score).map((row) => (
                            <tr key={row.key}>
                                <th scope="row">{row.label}</th>
                                <td>{row.yours.toLocaleString("en-US")}</td>
                                <td>{row.reference.toLocaleString("en-US")}</td>
                                <td className={row.comparison.better ? "score-better" : "score-worse"}>{row.comparison.text}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            {ranks
                ? <p className="score-hint">Each student counts once, by their best accepted result; a tie beats no one.</p>
                : <ScoreHint reference={score.reference} graderMain={graderMain} />}
        </div>
    );
}

export function ResultRow({ result, onOpen, formats, highlighted = false }) {
    return (
        <li className={`test-result ${result.passed ? "test-passed" : "test-failed"}${highlighted ? " test-first-failure" : ""}`}>
            <div className="test-result-head">
                <span className="test-mark" aria-hidden="true">{result.passed ? "✓" : "✗"}</span>
                <span className="test-name">{result.name}</span>
                <span className="test-kind">{result.passed ? "Passed" : result.kind_label}</span>
                {highlighted && <span className="first-failure-tag">First failure</span>}
                {result.visible && result.instructions > 0 && (
                    <span className="test-counts">
                        {result.instructions.toLocaleString("en-US")} instr · {result.memory_accesses.toLocaleString("en-US")} mem
                    </span>
                )}
                {result.visible && onOpen && <OpenButton test={result} onOpen={onOpen} />}
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

export function ResultList({ results, onOpen, formats, firstFailure = null }) {
    return (
        <ol className="test-results">
            {results.map((result, index) => (
                <ResultRow key={result.name} result={result} onOpen={onOpen} formats={formats}
                    highlighted={index === firstFailure} />
            ))}
        </ol>
    );
}

// A read-only program with line numbers, in the guide's code style.
export function CodeView({ code, label = "Submitted code" }) {
    const lines = code.replace(/\n$/, "").split("\n");
    return (
        <pre className="code-block submission-code" tabIndex={0} aria-label={label}>
            <code>
                {lines.map((line, index) => (
                    <span key={index} className="code-line">
                        <span className="code-line-number">{index + 1}</span>
                        <span className="code-line-text">{line || " "}</span>
                    </span>
                ))}
            </code>
        </pre>
    );
}
