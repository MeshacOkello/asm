import { useEffect, useState } from "react";
import ErrorMessage from "./ErrorMessage";
import { ChallengeRequestError, DIFFICULTIES, collectTags, difficultyLabel, filterProblems, requestJson, tagLabel } from "../challenges/problems";
import { loadProgress, progressStatus } from "../challenges/storage";
import { medalLabel, statusText } from "../challenges/scoring";
import { fromClient } from "../errors";
import "../challenges/challenges.css";

export function DifficultyBadge({ difficulty }) {
    return <span className={`difficulty difficulty-${difficulty}`}>{difficultyLabel(difficulty)}</span>;
}

export function Tags({ tags }) {
    return <span className="tag-list">{tags.map((tag) => <span key={tag} className="tag-chip">{tagLabel(tag)}</span>)}</span>;
}

export function MedalBadge({ medal, children }) {
    return <span className={`medal medal-${medal}`}>{children}</span>;
}

function StatusCell({ progress }) {
    const status = progressStatus(progress);
    if (status === "solved" && progress.best) {
        return <span className="challenge-status status-solved">
            Solved <MedalBadge medal={progress.best.medal}>{medalLabel(progress.best.medal)}</MedalBadge>
        </span>;
    }
    return <span className={`challenge-status status-${status ?? "new"}`}>{statusText(progress)}</span>;
}

export default function ChallengeList() {
    const [problems, setProblems] = useState(null);
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

    const tags = problems ? collectTags(problems) : [];
    const shown = problems ? filterProblems(problems, { difficulty, tag }) : [];

    return (
        <div className="challenges-page">
            <main className="challenges-content">
                <h1>Challenges</h1>
                <p className="challenges-lede">
                    Solve each problem in AArch64 assembly. Run checks your code against the visible tests;
                    Submit runs every test, hidden ones included, and scores an accepted solution against
                    the reference.
                </p>

                <fieldset className="challenge-filters">
                    <legend className="visually-hidden">Filter challenges</legend>
                    <label>
                        Difficulty
                        <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
                            <option value="">All</option>
                            {DIFFICULTIES.map((level) => <option key={level} value={level}>{difficultyLabel(level)}</option>)}
                        </select>
                    </label>
                    <label>
                        Tag
                        <select value={tag} onChange={(event) => setTag(event.target.value)}>
                            <option value="">All</option>
                            {tags.map((name) => <option key={name} value={name}>{tagLabel(name)}</option>)}
                        </select>
                    </label>
                    {problems && <span className="challenge-count" role="status">
                        {shown.length} of {problems.length} {problems.length === 1 ? "challenge" : "challenges"}
                    </span>}
                </fieldset>

                {error && <ErrorMessage error={error} />}
                {!problems && !error && <p className="challenge-loading">Loading challenges…</p>}

                {problems && (
                    <div className="reference-table challenge-table">
                        <table>
                            <thead>
                                <tr>
                                    <th scope="col">Title</th>
                                    <th scope="col">Difficulty</th>
                                    <th scope="col">Tags</th>
                                    <th scope="col">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shown.map((problem) => (
                                    <tr key={problem.slug}>
                                        <th scope="row"><a href={`#/problems/${problem.slug}`}>{problem.title}</a></th>
                                        <td><DifficultyBadge difficulty={problem.difficulty} /></td>
                                        <td><Tags tags={problem.tags} /></td>
                                        <td><StatusCell progress={loadProgress(problem.slug)} /></td>
                                    </tr>
                                ))}
                                {shown.length === 0 && (
                                    <tr><td colSpan={4} className="challenge-empty">No challenges match these filters.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </main>
        </div>
    );
}
