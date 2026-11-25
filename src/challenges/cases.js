// A test case as the console shows it: one labelled block per argument, and
// expected and actual values per register or memory region, so the one that
// differs can be pointed at.

function formatValue(type, value) {
    if (type === "long[]") return `[${value.join(", ")}]`;
    if (type === "char*") return JSON.stringify(value);
    return String(value);
}

// [{ label, value }] for what the test passes in.
export function inputFields(problem, test) {
    if (!problem?.function) return [{ label: "stdin", value: test.input ?? test.stdin ?? "" }];
    return problem.function.args.map(({ name, type }) => ({
        label: `${name} =`, value: formatValue(type, test.input[name]),
    }));
}

// The values a result is judged on, in a fixed order: x0, then memory.
function outputEntries(problem, value) {
    if (value == null) return [];
    if (!problem?.function) return [{ key: "stdout", label: "stdout", value }];
    const entries = [];
    if ("x0" in value) entries.push({ key: "x0", label: "x0", value: String(value.x0) });
    for (const [name, values] of Object.entries(value.memory ?? {})) {
        entries.push({ key: `memory:${name}`, label: `${name} (memory)`, value: values == null ? "unreadable" : `[${values.join(", ")}]` });
    }
    return entries;
}

// Expected and actual side by side; `differs` marks a value that is wrong.
// Actual is null when the run never produced one (an error or a limit).
export function outputFields(problem, result) {
    const expected = outputEntries(problem, result.expected);
    const actual = result.actual === undefined ? null : outputEntries(problem, result.actual);
    return expected.map((entry) => {
        const got = actual?.find((candidate) => candidate.key === entry.key) ?? null;
        return {
            label: entry.label,
            expected: entry.value,
            actual: got?.value ?? null,
            differs: got !== null && got.value !== entry.value,
        };
    });
}

// The case to show first: the first failing one, else the first.
export function initialCase(results) {
    if (!results?.length) return 0;
    const failing = results.findIndex((result) => result.visible && !result.passed);
    return failing === -1 ? 0 : failing;
}

// "stdout" values end in newlines that matter; show them.
export function visibleWhitespace(text) {
    return text.replace(/\n/g, "↵\n").replace(/\t/g, "→\t");
}
