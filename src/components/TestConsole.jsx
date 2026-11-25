import { useState } from "react";
import ErrorMessage from "./ErrorMessage";
import Icon from "./Icon";
import { CasePills, CaseView, OpenButton } from "./ChallengeResults";
import { initialCase } from "../challenges/cases";
import { resultHeadline } from "../challenges/scoring";

// The console under the editor: the visible test cases, and the result of the
// last Run, one case at a time. "Open in visualizer" always means the case
// that is selected, run with the code in the editor.
export default function TestConsole({ problem, run, stale = false, running, error, view, onViewChange, onOpen, formats }) {
    const tests = problem.tests;
    const [selected, setSelected] = useState(0);
    // A new Run opens on its first failing case; the last one seen is kept
    // per run, so switching tabs does not lose it.
    const [runSelection, setRunSelection] = useState({ run: null, index: 0 });
    const results = run?.results ?? null;
    const resultIndex = runSelection.run === run ? runSelection.index : initialCase(results);
    const index = view === "result" && results ? resultIndex : selected;
    const select = (next) => {
        if (view === "result" && results) setRunSelection({ run, index: next });
        else setSelected(next);
    };

    const showing = view === "result" && results ? results[index] : tests[index];
    const pills = (view === "result" && results ? results : tests).map((item, position) => ({
        key: item.id ?? position, label: `Case ${position + 1}`,
        passed: view === "result" && results ? item.passed : null,
    }));
    const headline = run ? resultHeadline(run) : null;

    return (
        <section className="pane console-pane" aria-label="Test console">
            <div className="pane-tabs" role="tablist" aria-label="Console">
                <button type="button" role="tab" className="pane-tab" aria-selected={view === "cases"} onClick={() => onViewChange("cases")}>
                    <Icon name="checkbox" size={15} /> Testcase
                </button>
                <span className="pane-tab-divider" aria-hidden="true" />
                <button type="button" role="tab" className="pane-tab" aria-selected={view === "result"} onClick={() => onViewChange("result")}>
                    <Icon name="terminal" size={15} /> Test Result
                </button>
                <span className="pane-tabs-spacer" />
                {(view === "cases" || results) && showing && (
                    <OpenButton test={showing} onOpen={onOpen} label={`Open case ${index + 1} in visualizer`} className="pane-action" />
                )}
            </div>
            <div className="pane-body console-body">
                {view === "result" && running && (
                    <p className="console-status" role="status"><span className="judging-spinner small" aria-hidden="true" /> Running the visible tests…</p>
                )}
                {view === "result" && !running && error && <ErrorMessage error={error} formats={formats} />}
                {view === "result" && !running && !error && !run && (
                    <p className="console-empty">Run your code to see each visible test’s output here.</p>
                )}
                {view === "result" && !running && !error && run && (
                    <p className="console-verdict" role="status">
                        <strong className={headline.accepted ? "verdict-text-accepted" : "verdict-text-failed"}>{headline.verdict}</strong>
                        <span>{headline.counts}</span>
                        {stale && <span className="console-stale">From an earlier version of your code. Run again to update.</span>}
                    </p>
                )}
                {(view === "cases" || (results && !running && !error)) && showing && <>
                    <CasePills cases={pills} selected={index} onSelect={select} />
                    <CaseView problem={problem} test={showing} result={view === "result" ? showing : null} formats={formats} />
                </>}
            </div>
        </section>
    );
}
