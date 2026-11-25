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
