// How a challenge result is described: verdicts, and how an accepted
// program's counts compare with the reference solution's.

export const METRICS = [
    { key: "instructions", label: "Instructions executed" },
    { key: "memory_accesses", label: "Memory accesses" },
];

// Fewer instructions wins; fewer memory accesses breaks a tie, as in rankings.
export function isBetterResult(candidate, current) {
    if (!candidate || !Number.isInteger(candidate.instructions)) return false;
    if (!current) return true;
    if (candidate.instructions !== current.instructions) return candidate.instructions < current.instructions;
    return candidate.memory_accesses < current.memory_accesses;
}

// "Same as the reference", "4 fewer than the reference", or
// "12 more than the reference (1.25×)".
export function compareToReference(value, reference) {
    const difference = value - reference;
    if (difference === 0) return { difference, text: "Same as the reference", better: true };
    if (difference < 0) {
        return { difference, text: `${(-difference).toLocaleString("en-US")} fewer than the reference`, better: true };
    }
    const ratio = reference > 0 ? ` (${(value / reference).toFixed(2).replace(/\.?0+$/, "")}×)` : "";
    return { difference, text: `${difference.toLocaleString("en-US")} more than the reference${ratio}`, better: false };
}

// One row per metric for the score table of an accepted submission.
export function scoreRows(score) {
    if (!score?.reference) return [];
    return METRICS.map(({ key, label }) => ({
        key,
        label,
        yours: score[key],
        reference: score.reference[key],
        comparison: compareToReference(score[key], score.reference[key]),
    }));
}

export const VERDICT_LABELS = {
    accepted: "Accepted",
    wrong_answer: "Wrong answer",
    runtime_error: "Runtime error",
    instruction_limit: "Exceeded instruction limit",
    time_limit: "Exceeded time limit",
    assembler_error: "Assembler error",
};

export function verdictLabel(verdict) {
    return VERDICT_LABELS[verdict] ?? "Not graded";
}

// The headline of a results panel: "Accepted", "3 of 9 tests passed".
export function resultHeadline(response) {
    const passed = response?.passed ?? 0;
    const totalTests = response?.total ?? 0;
    const scope = response?.mode === "run" ? "visible tests" : "tests";
    return {
        verdict: response?.verdict_label ?? verdictLabel(response?.verdict),
        accepted: response?.verdict === "accepted",
        counts: `${passed} of ${totalTests} ${scope} passed`,
    };
}

// The status cell of the problem list.
export function statusText(progress) {
    if (progress?.solved) return "Solved";
    return progress?.attempted ? "Attempted" : "Not started";
}
