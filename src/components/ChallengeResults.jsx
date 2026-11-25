// The pieces that show a test or a grade, shared by the test console under
// the editor and a submission's result in the left pane.
import { useMemo, useState } from "react";
import ErrorMessage from "./ErrorMessage";
import Icon from "./Icon";
import { MedalBadge } from "./ChallengeList";
import { MEDALS, medalLabel, medalThresholds } from "../challenges/scoring";
import { inputFields, outputFields, visibleWhitespace } from "../challenges/cases";
import { diffStats, lineDiff } from "../challenges/diff";
import { fromResponse } from "../errors";

// A read-only value: a filled block, never something that looks editable.
export function ValueBlock({ label, value, tone = null, whitespace = false }) {
    return (
        <div className="value-field">
            <div className="value-label">{label}</div>
            <pre className={`value-block${tone ? ` value-${tone}` : ""}`}>
                {value == null ? <span className="value-none">no value</span>
                    : value === "" ? <span className="value-none">(empty)</span>
                        : whitespace ? visibleWhitespace(value) : value}
            </pre>
        </div>
    );
}

export function OpenButton({ test, onOpen, label = "Open in visualizer", className = "" }) {
    return (
        <button type="button" className={`open-test ${className}`} disabled={!test} aria-label={label} title={label}
            onClick={(event) => onOpen(test, event.currentTarget)}>
            <Icon name="open" /> <span className="open-label">{label}</span>
        </button>
    );
}

// Case 1, Case 2… with a pass or fail mark once there are results.
export function CasePills({ cases, selected, onSelect, label = "Test cases" }) {
    return (
        <div className="case-pills" role="tablist" aria-label={label}>
            {cases.map((item, index) => (
                <button key={item.key} type="button" role="tab" aria-selected={index === selected}
                    className={`case-pill${item.passed === true ? " case-passed" : item.passed === false ? " case-failed" : ""}`}
                    onClick={() => onSelect(index)}>
                    {item.passed != null && <span className="case-dot" aria-hidden="true" />}
                    {item.label}
                    {item.passed != null && <span className="visually-hidden">{item.passed ? " passed" : " failed"}</span>}
                </button>
            ))}
        </div>
    );
}

// One visible test: what goes in, and for a result, what came out next to
// what was expected, with the value that differs marked.
export function CaseView({ problem, test, result = null, formats }) {
    const io = !problem?.function;
    const outputs = outputFields(problem, result ?? test);
    return (
        <div className="case-view">
            {inputFields(problem, test).map((field) => (
                <ValueBlock key={field.label} label={field.label} value={field.value} whitespace={io} />
            ))}
            {result && <>
                {outputs.map((field) => (
                    <ValueBlock key={`actual-${field.label}`} label={io ? "Output" : `Output · ${field.label}`}
                        value={field.actual} tone={field.differs ? "wrong" : result.passed ? "right" : null}
                        whitespace={io} />
                ))}
                {outputs.map((field) => (
                    <ValueBlock key={`expected-${field.label}`} label={io ? "Expected" : `Expected · ${field.label}`}
                        value={field.expected} whitespace={io} />
                ))}
                {result.error
                    ? <ErrorMessage error={fromResponse({ error_info: result.error })} formats={formats} />
                    : !result.passed && result.message && <p className="case-message">{result.message}</p>}
                {result.instructions > 0 && (
                    <p className="case-counts">
                        {result.instructions.toLocaleString("en-US")} instructions · {result.memory_accesses.toLocaleString("en-US")} memory accesses
                    </p>
                )}
            </>}
            {!result && !io && (
                <ValueBlock label="Expected" value={outputs.map((field) => `${field.label} = ${field.expected}`).join("\n")} />
            )}
        </div>
    );
}

// --- performance ------------------------------------------------------------

const METRIC_INFO = [
    { key: "instructions", label: "Instructions", icon: "chart" },
    { key: "memory_accesses", label: "Memory accesses", icon: "chart" },
];

function Distribution({ metric, data }) {
    const { bars, yours } = data.distribution;
    const most = Math.max(1, ...bars.map((bar) => bar.users));
    const width = 100 / bars.length;
    const yoursAt = `${(yours + 0.5) * width}%`;
    return (
        <figure className="distribution">
            <div className="distribution-plot">
                <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img"
                    aria-label={`${data.beats}% of other students used more ${metric.label.toLowerCase()}`}>
                    {bars.map((bar, index) => {
                        const height = bar.users ? Math.max(2, (bar.users / most) * 34) : 0.6;
                        return <rect key={index} x={index * width + width * 0.15} width={width * 0.7}
                            y={40 - height} height={height} rx="0.6"
                            className={index === yours ? "bar-yours" : "bar-other"} />;
                    })}
                </svg>
                <span className="distribution-you" style={{ left: yoursAt }}>
                    <span className="you-label">You</span>
                </span>
            </div>
            <figcaption className="distribution-axis">
                <span>{bars[0].low.toLocaleString("en-US")}</span>
                <span className="distribution-key">Students by their best accepted result</span>
                <span>{bars[bars.length - 1].high.toLocaleString("en-US")}</span>
            </figcaption>
        </figure>
    );
}

// Gold, silver and bronze as bands along the metric, with a marker for you.
function ReferenceScale({ metric, value, reference }) {
    const limits = medalThresholds(reference);
    const gold = limits.gold[metric.key];
    const silver = limits.silver[metric.key];
    if (gold === 0) {
        return <p className="scale-note">
            The reference makes no {metric.label.toLowerCase()}; {value === 0 ? "neither do you." : "any at all leaves gold out of reach."}
        </p>;
    }
    const end = Math.max(value, silver) * 1.15;
    const at = (n) => `${Math.min(100, (n / end) * 100)}%`;
    return (
        <div className="reference-scale" aria-label={`${value} against a reference of ${gold}`}>
            <div className="scale-track">
                <span className="scale-band band-gold" style={{ width: at(gold) }} />
                <span className="scale-band band-silver" style={{ left: at(gold), width: `calc(${at(silver)} - ${at(gold)})` }} />
                <span className="scale-band band-bronze" style={{ left: at(silver), right: 0 }} />
                <span className="scale-marker" style={{ left: at(value) }}><span>You {value.toLocaleString("en-US")}</span></span>
            </div>
            <div className="scale-labels">
                <span style={{ left: at(gold) }}>Reference {gold.toLocaleString("en-US")}</span>
                <span style={{ left: at(silver) }}>1.5× {silver.toLocaleString("en-US")}</span>
            </div>
        </div>
    );
}

// The two counts that measure an accepted program, side by side. Selecting
// one shows where it stands: among other students once enough have solved
// the problem, otherwise against the reference solution's medal bands.
export function Performance({ score, ranking, graderMain }) {
    const [selected, setSelected] = useState("instructions");
    const metric = METRIC_INFO.find((item) => item.key === selected);
    return (
        <section className="performance" aria-label="Performance">
            <div className="metric-cards" role="tablist" aria-label="Measure">
                {METRIC_INFO.map((item) => {
                    const rank = ranking?.[item.key];
                    return (
                        <button key={item.key} type="button" role="tab" aria-selected={selected === item.key}
                            className="metric-card" onClick={() => setSelected(item.key)}>
                            <span className="metric-label">{item.label}</span>
                            <span className="metric-value">
                                <strong>{score[item.key].toLocaleString("en-US")}</strong>
                                {rank
                                    ? <span className="metric-compare">Beats <b>{rank.beats}%</b></span>
                                    : <span className="metric-compare">Reference {score.reference[item.key].toLocaleString("en-US")}</span>}
                            </span>
                        </button>
                    );
                })}
            </div>
            <div className="metric-detail" role="tabpanel">
                {ranking
                    ? <Distribution metric={metric} data={ranking[selected]} />
                    : <ReferenceScale metric={metric} value={score[selected]} reference={score.reference} />}
            </div>
            <p className="performance-medal">
                <MedalBadge medal={score.medal}>{medalLabel(score.medal)}</MedalBadge>
                <span>{MEDALS[score.medal]?.rule}.{graderMain ? " Only your code is counted, not the grader’s main." : ""}</span>
            </p>
        </section>
    );
}

// --- code -------------------------------------------------------------------

const COLLAPSED_LINES = 10;

export function CodeView({ code, label = "Submitted code" }) {
    const [expanded, setExpanded] = useState(false);
    const lines = code.replace(/\n$/, "").split("\n");
    const shown = expanded ? lines : lines.slice(0, COLLAPSED_LINES);
    return (
        <div className={`code-view${!expanded && lines.length > COLLAPSED_LINES ? " code-view-collapsed" : ""}`}>
            <pre className="code-block submission-code" tabIndex={0} aria-label={label}>
                <code>
                    {shown.map((line, index) => (
                        <span key={index} className="code-line">
                            <span className="code-line-number">{index + 1}</span>
                            <span className="code-line-text">{line || " "}</span>
                        </span>
                    ))}
                </code>
            </pre>
            {lines.length > COLLAPSED_LINES && (
                <button type="button" className="view-more" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
                    {expanded ? "Show less" : `View all ${lines.length} lines`}
                </button>
            )}
        </div>
    );
}

export function DiffView({ before, after }) {
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
