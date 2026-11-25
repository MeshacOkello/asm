// How a challenge result is described: verdicts, medals, and how a score
// compares with the reference solution's. The backend decides the medal; this
// only presents it, and ranks stored results to keep the best one.

export const MEDALS = {
    gold: { label: "Gold", rank: 3, rule: "At most the reference's instructions and memory accesses" },
    silver: { label: "Silver", rank: 2, rule: "Within 1.5× the reference on both counts" },
    bronze: { label: "Bronze", rank: 1, rule: "Accepted, but over 1.5× the reference on a count" },
};

export const METRICS = [
    { key: "instructions", label: "Instructions executed" },
    { key: "memory_accesses", label: "Memory accesses" },
];

export function normalizeMedal(medal) {
    return Object.hasOwn(MEDALS, medal ?? "") ? medal : null;
}

export function medalLabel(medal) {
    return MEDALS[normalizeMedal(medal)]?.label ?? null;
}

export function medalRank(medal) {
    return MEDALS[normalizeMedal(medal)]?.rank ?? 0;
}

function total(result) {
    return result.instructions + result.memory_accesses;
}

// A higher medal wins; between equal medals, the smaller combined total.
export function isBetterResult(candidate, current) {
    if (!candidate || !normalizeMedal(candidate.medal)) return false;
    if (!current) return true;
    const byMedal = medalRank(candidate.medal) - medalRank(current.medal);
    if (byMedal !== 0) return byMedal > 0;
    return total(candidate) < total(current);
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

// The largest totals that still earn each medal, for the hint under a score.
export function medalThresholds(reference) {
    return {
        gold: { ...reference },
        silver: Object.fromEntries(METRICS.map(({ key }) => [key, Math.floor((reference[key] * 3) / 2)])),
    };
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
    if (progress?.solved) {
        const medal = medalLabel(progress.best?.medal);
        return medal ? `Solved · ${medal}` : "Solved";
    }
    return progress?.attempted ? "Attempted" : "Not started";
}
