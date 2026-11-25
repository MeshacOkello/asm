// A line diff between two versions of a program, for "Compare with previous
// attempt". Longest common subsequence over lines: exact and easy to follow,
// and programs here are short. Past MAX_CELLS the table would be too large,
// so the whole of each side is shown as removed and added instead.

const MAX_CELLS = 4_000_000;

function lines(text) {
    if (text === "") return [];
    return text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

// [{ type: "same" | "removed" | "added", text, before, after }], where
// `before` and `after` are 1-based line numbers in each version (or null).
export function lineDiff(beforeText, afterText) {
    const before = lines(beforeText);
    const after = lines(afterText);
    const n = before.length;
    const m = after.length;

    if ((n + 1) * (m + 1) > MAX_CELLS) {
        return [
            ...before.map((text, index) => ({ type: "removed", text, before: index + 1, after: null })),
            ...after.map((text, index) => ({ type: "added", text, before: null, after: index + 1 })),
        ];
    }

    // lengths[i][j]: the LCS of before[i..] and after[j..].
    const width = m + 1;
    const lengths = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lengths[i * width + j] = before[i] === after[j]
                ? lengths[(i + 1) * width + j + 1] + 1
                : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
        }
    }

    const result = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (before[i] === after[j]) {
            result.push({ type: "same", text: before[i], before: i + 1, after: j + 1 });
            i++;
            j++;
        } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
            result.push({ type: "removed", text: before[i], before: i + 1, after: null });
            i++;
        } else {
            result.push({ type: "added", text: after[j], before: null, after: j + 1 });
            j++;
        }
    }
    for (; i < n; i++) result.push({ type: "removed", text: before[i], before: i + 1, after: null });
    for (; j < m; j++) result.push({ type: "added", text: after[j], before: null, after: j + 1 });
    return result;
}

export function diffStats(diff) {
    return {
        added: diff.filter((line) => line.type === "added").length,
        removed: diff.filter((line) => line.type === "removed").length,
    };
}
