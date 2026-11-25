// The pieces that show a test or a grade, shared by the test console under
// the editor and a submission's result in the left pane.
import { useMemo, useState } from "react";
import ErrorMessage from "./ErrorMessage";
import Icon from "./Icon";
import { chartLayout } from "../challenges/submissions";
import { Avatar } from "./UserMenu";
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
    { key: "instructions", label: "Instructions", unit: "instr", icon: "cpu" },
    { key: "memory_accesses", label: "Memory accesses", unit: "loads/stores", icon: "memory" },
];

function rangeText(bar) {
    if (bar.overflow) return `${bar.low.toLocaleString("en-US")} or more`;
    return bar.low === bar.high ? bar.low.toLocaleString("en-US")
        : `${bar.low.toLocaleString("en-US")}–${bar.high.toLocaleString("en-US")}`;
}

// The range selector under the chart: a grey overview of every bar, with
// two handles that pick which bars the chart above shows.
function RangeSelector({ bars, start, end, onChange, label }) {
    const most = Math.max(1, ...bars.map((bar) => bar.users));
    const count = bars.length;
    const last = count - 1;
    return (
        <div className="chart-brush">
            <div className="brush-bars" aria-hidden="true">
                {bars.map((bar, index) => (
                    <span key={index} className={`brush-column${index >= start && index <= end ? " brush-in" : ""}`}>
                        <span className="brush-bar" style={{ height: `${bar.users ? Math.max(12, (bar.users / most) * 100) : 6}%` }} />
                    </span>
                ))}
                <span className="brush-window" style={{ left: `${(start / count) * 100}%`, width: `${((end - start + 1) / count) * 100}%` }} />
            </div>
            <input type="range" className="brush-handle" min={0} max={last} value={start}
                aria-label={`${label}: first range shown`} aria-valuetext={rangeText(bars[start])}
                onChange={(event) => onChange(Math.min(Number(event.target.value), end), end)} />
            <input type="range" className="brush-handle" min={0} max={last} value={end}
                aria-label={`${label}: last range shown`} aria-valuetext={rangeText(bars[end])}
                onChange={(event) => onChange(start, Math.max(Number(event.target.value), start))} />
        </div>
    );
}

// Other students' best results, LeetCode style: blue bars giving each range's
// share of students on a percentage axis, your range in solid blue with your
// avatar above it, and the reference solution marked. Below the ranking
// threshold only you and the reference are on it.
function Distribution({ metric, data, ranked, threshold, user }) {
    const bars = data.distribution.bars;
    const [range, setRange] = useState([0, bars.length - 1]);
    const [start, end] = range[1] < bars.length ? range : [0, bars.length - 1];
    const layout = chartLayout(data.distribution, start, end);
    const count = layout.bars.length;
    const yours = data.distribution.bars[data.distribution.yours];
    const reference = data.distribution.reference != null ? data.distribution.bars[data.distribution.reference] : null;
    return (
        <figure className={`chart${count > 30 ? " chart-dense" : ""}`}
            aria-label={ranked ? `${metric.label}: you beat ${data.beats}% of other students` : `${metric.label}: yours and the reference`}>
            <div className="chart-area">
                {layout.gridlines.map((line) => (
                    <span key={line} className="chart-gridline" style={{ bottom: `${(line / layout.yMax) * 100}%` }}>
                        {!layout.empty && <span className="chart-y">{line}%</span>}
                    </span>
                ))}
                <div className="chart-bars" aria-hidden="true">
                    {layout.bars.map((bar) => (
                        <span key={bar.index} className={`chart-column${bar.yours ? " chart-yours" : ""}${bar.overflow ? " chart-overflow" : ""}`}
                            title={`${rangeText(bar)} ${metric.unit}: ${bar.users} ${bar.users === 1 ? "student" : "students"}`}>
                            <span className="chart-bar" style={{ height: bar.users ? `${bar.height}%` : undefined }} />
                            {bar.reference && <span className="chart-reference"><span>Reference</span></span>}
                            {bar.yours && (
                                <span className="chart-marker" style={{ bottom: `${bar.height}%` }}>
                                    {user ? <Avatar user={user} className="chart-avatar" /> : <span className="chart-avatar avatar-initial">•</span>}
                                </span>
                            )}
                        </span>
                    ))}
                </div>
            </div>
            <div className="chart-x" aria-hidden="true">
                {layout.ticks.map((tick) => (
                    <span key={tick.index} style={{ left: `${((tick.index + 0.5) / count) * 100}%` }}>
                        {tick.label.toLocaleString("en-US")}{tick.overflow ? "+" : ""}
                    </span>
                ))}
            </div>
            {bars.length > 8 && (
                <RangeSelector bars={bars} start={start} end={end} label={metric.label}
                    onChange={(first, last) => setRange([first, last])} />
            )}
            <figcaption className="chart-caption">
                You: {rangeText(yours)} {metric.unit}
                {reference && <> · Reference: {rangeText(reference)}</>}
                {" · "}
                {ranked
                    ? "each other student counted once, by their best accepted result"
                    : `classmates appear once ${threshold ?? "enough"} students have solved this problem`}
            </figcaption>
        </figure>
    );
}

// The two counts that measure an accepted program, side by side, LeetCode
// style. Selecting one charts it: among other students once enough have
// solved the problem, and against the reference solution always.
export function Performance({ score, ranking, user }) {
    const [selected, setSelected] = useState("instructions");
    const metric = METRIC_INFO.find((item) => item.key === selected);
    const ranked = Boolean(ranking?.ranked);
    return (
        <section className="performance" aria-label="Performance">
            <div className="metric-cards" role="tablist" aria-label="Measure">
                {METRIC_INFO.map((item) => (
                    <button key={item.key} type="button" role="tab" aria-selected={selected === item.key}
                        className="metric-card" onClick={() => setSelected(item.key)}>
                        <span className="metric-label"><Icon name={item.icon} size={15} /> {item.label}</span>
                        <span className="metric-value">
                            <strong>{score[item.key].toLocaleString("en-US")}</strong>
                            <span className="metric-unit">{item.unit}</span>
                            <span className="metric-divider" aria-hidden="true" />
                            {ranked
                                ? <span className="metric-compare">Beats <b>{ranking[item.key].beats}%</b></span>
                                : <span className="metric-compare">Reference <b>{score.reference[item.key].toLocaleString("en-US")}</b></span>}
                        </span>
                    </button>
                ))}
            </div>
            {ranking && (
                <div className="metric-detail" role="tabpanel">
                    <Distribution key={selected} metric={metric} data={ranking[selected]} ranked={ranked}
                        threshold={ranking.threshold} user={user} />
                </div>
            )}
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
