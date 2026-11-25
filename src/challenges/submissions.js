// Presenting a submission: when it was made, which test to show first, and
// how it ranks. Pure functions, so they are unit tested without a browser.

export function formatTimestamp(ms, { locale, timeZone } = {}) {
    if (!Number.isFinite(ms)) return "";
    return new Intl.DateTimeFormat(locale ?? "en-US", {
        dateStyle: "medium", timeStyle: "short", ...(timeZone ? { timeZone } : {}),
    }).format(new Date(ms));
}

// "just now", "5 min ago", "3 h ago", "2 days ago", then the date.
export function relativeTime(ms, now = Date.now(), options = {}) {
    const seconds = Math.max(0, Math.round((now - ms) / 1000));
    if (seconds < 45) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
    return formatTimestamp(ms, options);
}

export function isJudging(submission) {
    return submission?.status === "judging";
}

// The test "Open in visualizer" starts from: the first failing visible test,
// or the first visible test when nothing visible failed.
export function visualizerTest(results) {
    const visible = (results ?? []).filter((result) => result.visible);
    return visible.find((result) => !result.passed) ?? visible[0] ?? null;
}

// The rows of the "beats X% of students" card, or null below the threshold.
export function rankingRows(ranking) {
    if (!ranking) return null;
    return [
        { key: "instructions", label: "Instructions executed", ...ranking.instructions },
        { key: "memory_accesses", label: "Memory accesses", ...ranking.memory_accesses },
    ].map((row) => ({ ...row, text: `Beats ${row.beats}% of students` }));
}

// "12 instr · 3 mem" for a history row, or "—" for one with no score.
export function metricsText(submission) {
    if (submission?.instructions == null) return "—";
    return `${submission.instructions.toLocaleString("en-US")} instr · `
        + `${submission.memory_accesses.toLocaleString("en-US")} mem`;
}

export function attemptLabel(submission, now) {
    return `#${submission.id} · ${submission.verdict_label} · ${relativeTime(submission.created_at, now)}`;
}

// The local time zone the profile's streaks are counted in.
export function localTimeZone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

const MAX_TICKS = 6;

// A y axis step that keeps the chart to a few gridlines, as LeetCode's do:
// 5% steps for a flat chart, 10% up to 30%, then 25%.
function yStep(top) {
    if (top <= 15) return 5;
    if (top <= 30) return 10;
    return 25;
}

// The distribution chart's layout for the bars from `start` to `end`: each
// bar as a share of all the students counted, a y axis with a few round
// gridlines, and at most six evenly spaced x labels.
export function chartLayout(distribution, start = 0, end = distribution.bars.length - 1) {
    const { bars, yours, reference } = distribution;
    const total = bars.reduce((sum, bar) => sum + bar.users, 0);
    const shown = bars.slice(start, end + 1);
    const shares = shown.map((bar) => (total ? (bar.users / total) * 100 : 0));
    const top = Math.max(0, ...shares);
    const step = yStep(top);
    const yMax = Math.min(100, Math.max(step, Math.ceil(top / step) * step));
    const tickStep = Math.max(1, Math.ceil(shown.length / MAX_TICKS));
    const last = shown.length - 1;
    const overflowShown = Boolean(shown.at(-1)?.overflow);
    return {
        empty: total === 0,
        yMax,
        gridlines: Array.from({ length: yMax / step + 1 }, (_, index) => index * step),
        bars: shown.map((bar, offset) => ({
            ...bar, index: start + offset, share: shares[offset], height: (shares[offset] / yMax) * 100,
            yours: start + offset === yours, reference: start + offset === reference,
        })),
        // The overflow bar, past the bulk of results, is always labelled "N+".
        ticks: shown.map((bar, offset) => ({ index: offset, label: bar.low, overflow: Boolean(bar.overflow) }))
            .filter(({ index, overflow }) => overflow
                || (index % tickStep === 0 && !(overflowShown && index > last - tickStep))),
    };
}
