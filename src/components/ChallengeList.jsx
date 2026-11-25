import { useEffect, useState } from "react";
import ErrorMessage from "./ErrorMessage";
import { ChallengeRequestError, DIFFICULTIES, collectTags, difficultyLabel, filterProblems, requestJson, tagLabel } from "../challenges/problems";
import { loadProgress, progressStatus } from "../challenges/storage";
import { statusText } from "../challenges/scoring";
import Icon from "./Icon";
import { fromClient } from "../errors";
import { accountApi, loginErrorFrom } from "../account";
import { ImportOffer } from "./ProfilePage";
import "../challenges/challenges.css";

export function DifficultyBadge({ difficulty }) {
    return <span className={`difficulty difficulty-${difficulty}`}>{difficultyLabel(difficulty)}</span>;
}

export function Tags({ tags }) {
    return <span className="tag-list">{tags.map((tag) => <span key={tag} className="tag-chip">{tagLabel(tag)}</span>)}</span>;
}

// A check for solved, a half circle for tried, nothing for not started.
function StatusMark({ progress }) {
    const status = progressStatus(progress);
    return (
        <span className={`status-mark status-mark-${status ?? "new"}`} title={statusText(progress)}>
            {status === "solved" && <Icon name="check" size={16} />}
            {status === "attempted" && <span className="attempted-dot" aria-hidden="true" />}
            <span className="visually-hidden">{statusText(progress)}</span>
        </span>
    );
}

function SolvedRing({ solved, total }) {
    const fraction = total ? solved / total : 0;
    const circumference = 2 * Math.PI * 8;
    return (
        <span className="solved-ring" role="status">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <circle cx="10" cy="10" r="8" className="ring-track" />
                <circle cx="10" cy="10" r="8" className="ring-fill"
                    strokeDasharray={`${fraction * circumference} ${circumference}`} transform="rotate(-90 10 10)" />
            </svg>
            {solved}/{total} Solved
        </span>
    );
}

export default function ChallengeList({ user, onAccountChange }) {
    const [problems, setProblems] = useState(null);
    // Signed in: progress from the account; signed out: from this browser.
    const [serverProgress, setServerProgress] = useState(null);
    const [loginError] = useState(() => loginErrorFrom(window.location.hash));
    const [error, setError] = useState(null);
    const [difficulty, setDifficulty] = useState("");
    const [tag, setTag] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        requestJson("/problems", { signal: controller.signal })
            .then((data) => setProblems(data.problems))
            .catch((failure) => {
                if (failure?.name === "AbortError") return;
                setError(failure instanceof ChallengeRequestError ? failure.error : fromClient(failure));
            });
        return () => controller.abort();
    }, []);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    useEffect(() => {
        if (!user) return undefined;
        const controller = new AbortController();
        accountApi.progress(controller.signal)
            .then((data) => setServerProgress({ userId: user.id, progress: data.progress }))
            .catch(() => {});
        return () => controller.abort();
    }, [user]);

    const accountProgress = user && serverProgress?.userId === user.id ? serverProgress.progress : null;
    const progressOf = (slug) => (user
        ? accountProgress?.[slug] ?? { attempted: false, solved: false, best: null }
        : loadProgress(slug));

    const tags = problems ? collectTags(problems) : [];
    const shown = problems ? filterProblems(problems, { difficulty, tag }) : [];

    return (
        <div className="challenges-page">
            <main className="challenges-content">
                <header className="list-head">
                    <h1>Challenges</h1>
                    <p className="challenges-lede">
                        Write each solution in AArch64 assembly. Run checks the visible tests; Submit grades every
                        test and measures the instructions and memory accesses your code takes.
                    </p>
                </header>

                {loginError && (
                    <ErrorMessage error={{ kind: "request", message: loginError, parts: null, line: null,
                        sourceLine: null, suggestion: "Select Sign in to try again.", detail: null }} />
                )}
                <ImportOffer user={user} onDone={onAccountChange} />
                {error && <ErrorMessage error={error} />}

                <div className="list-controls">
                    <fieldset className="challenge-filters">
                        <legend className="visually-hidden">Filter challenges</legend>
                        <label>
                            <span className="visually-hidden">Difficulty</span>
                            <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
                                <option value="">All difficulties</option>
                                {DIFFICULTIES.map((level) => <option key={level} value={level}>{difficultyLabel(level)}</option>)}
                            </select>
                        </label>
                        <label>
                            <span className="visually-hidden">Topic</span>
                            <select value={tag} onChange={(event) => setTag(event.target.value)}>
                                <option value="">All topics</option>
                                {tags.map((name) => <option key={name} value={name}>{tagLabel(name)}</option>)}
                            </select>
                        </label>
                        {(difficulty || tag) && (
                            <button type="button" className="quiet-button" onClick={() => { setDifficulty(""); setTag(""); }}>Clear</button>
                        )}
                    </fieldset>
                    {problems && <SolvedRing solved={problems.filter((problem) => progressOf(problem.slug).solved).length}
                        total={problems.length} />}
                </div>

                {!problems && !error && <p className="challenge-loading">Loading challenges…</p>}
                {problems && (
                    <ol className="problem-rows" aria-label={`${shown.length} of ${problems.length} challenges`}>
                        {shown.map((problem) => {
                            const progress = progressOf(problem.slug);
                            return (
                                <li key={problem.slug}>
                                    <a className="problem-row" href={`#/problems/${problem.slug}`}>
                                        <StatusMark progress={progress} />
                                        <span className="problem-title">{problem.title}</span>
                                        <span className="problem-tags">{problem.tags.map(tagLabel).join(" · ")}</span>
                                        <DifficultyBadge difficulty={problem.difficulty} />
                                    </a>
                                </li>
                            );
                        })}
                        {shown.length === 0 && <li className="challenge-empty">No challenges match these filters.</li>}
                    </ol>
                )}
            </main>
        </div>
    );
}
