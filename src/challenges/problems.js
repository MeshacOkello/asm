// Talking to the challenge endpoints, and the small pure helpers the
// Challenges pages share.
import { fromClient, fromResponse, fromTransport } from "../errors.js";

export const DIFFICULTIES = ["easy", "medium", "hard"];

export function difficultyLabel(difficulty) {
    return difficulty ? difficulty[0].toUpperCase() + difficulty.slice(1) : "";
}

export function tagLabel(tag) {
    return tag.replace(/-/g, " ");
}

// Every tag used by any problem, sorted, for the tag filter.
export function collectTags(problems) {
    return [...new Set(problems.flatMap((problem) => problem.tags))].sort();
}

// "" means any difficulty, or any tag.
export function filterProblems(problems, { difficulty = "", tag = "" } = {}) {
    return problems.filter((problem) =>
        (!difficulty || problem.difficulty === difficulty) && (!tag || problem.tags.includes(tag)));
}

// The program "Open in visualizer" loads for a visible test: for a function
// problem the student's code with the grader's main after it, exactly as it
// was graded; for an io problem the code alone, with the test's stdin.
export function visualizerProgram(problem, test, code) {
    if (test.harness) {
        return { source: (code.endsWith("\n") ? code : `${code}\n`) + test.harness, stdin: null };
    }
    return { source: code, stdin: test.stdin ?? null };
}

export class ChallengeRequestError extends Error {
    constructor(error, { status = null, loginRequired = false } = {}) {
        super(error.message);
        this.name = "ChallengeRequestError";
        this.error = error;
        this.status = status;
        this.loginRequired = loginRequired;
    }
}

// The UI's error shape for anything a request threw.
export function failureFrom(error) {
    return error instanceof ChallengeRequestError ? error.error : fromClient(error);
}

// A JSON request whose failures all come back as the UI's one error shape.
export async function requestJson(url, { body, signal, method } = {}) {
    let response;
    try {
        response = await fetch(url, body === undefined ? { signal } : {
            method: method ?? "POST",
            headers: { "Content-type": "application/json" },
            body: JSON.stringify(body),
            signal,
        });
    } catch (error) {
        const failure = fromTransport(error);
        if (!failure) throw error;   // cancelled
        throw new ChallengeRequestError(failure);
    }
    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new ChallengeRequestError(fromTransport(null, { status: response.status, body: text }));
    }
    if (!response.ok) {
        throw new ChallengeRequestError(fromResponse(data, { status: response.status }), {
            status: response.status, loginRequired: data?.login_required === true,
        });
    }
    return data;
}
