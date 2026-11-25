import { useEffect, useState } from "react";
import ErrorMessage from "./ErrorMessage";
import { DifficultyBadge, MedalBadge } from "./ChallengeList";
import { VerdictText } from "./ChallengeWorkspace";
import { accountApi, loginUrl } from "../account";
import { DIFFICULTIES, difficultyLabel, failureFrom } from "../challenges/problems";
import { collectLocalData, hasLocalData } from "../challenges/storage";
import { medalLabel } from "../challenges/scoring";
import { localTimeZone, metricsText, relativeTime } from "../challenges/submissions";
import "../challenges/challenges.css";

// The one-time offer to bring this browser's drafts and progress into the
// account. Shown only while the account has not imported (or declined) yet.
export function ImportOffer({ user, onDone }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [local] = useState(() => collectLocalData());
    if (!user?.can_import || !hasLocalData(local)) return null;
    const solved = Object.values(local.progress).filter((entry) => entry.solved).length;
    const drafts = Object.keys(local.drafts).length;

    async function send(payload) {
        setBusy(true);
        setError(null);
        try {
            const result = await accountApi.importLocal(payload);
            onDone?.(result);
        } catch (failure) {
            setError(failureFrom(failure));
            setBusy(false);
        }
    }

    return (
        <div className="import-offer" role="region" aria-label="Import progress from this browser">
            <div>
                <strong>Bring your progress into your account?</strong>
                <p>
                    This browser has {drafts} {drafts === 1 ? "draft" : "drafts"} and {solved} solved {solved === 1 ? "problem" : "problems"}
                    {" "}from before you signed in. Imported solves join your solved record; streaks and rankings
                    count only submissions graded from your account. This is offered once.
                </p>
                {error && <ErrorMessage error={error} />}
            </div>
            <div className="import-actions">
                <button type="button" disabled={busy} onClick={() => send({ decline: true })}>Don’t import</button>
                <button type="button" className="primary" disabled={busy} onClick={() => send(local)}>
                    {busy ? "Importing…" : "Import"}
                </button>
            </div>
        </div>
    );
}

function Stat({ label, value, detail }) {
    return (
        <div className="profile-stat">
            <span className="profile-stat-value">{value}</span>
            <span className="profile-stat-label">{label}</span>
            {detail && <span className="profile-stat-detail">{detail}</span>}
        </div>
    );
}

export default function ProfilePage({ user, onAccountChange }) {
    const [profile, setProfile] = useState(null);
    const [error, setError] = useState(null);
    const [version, setVersion] = useState(0);

    useEffect(() => {
        if (!user) return undefined;
        const controller = new AbortController();
        accountApi.profile(localTimeZone(), controller.signal)
            .then(setProfile)
            .catch((failure) => {
                if (failure?.name !== "AbortError") setError(failureFrom(failure));
            });
        return () => controller.abort();
    }, [user, version]);

    useEffect(() => {
        document.title = "Profile · Assembly Visualizer";
        window.scrollTo(0, 0);
    }, []);

    if (user === null) {
        return <div className="challenges-page"><main className="challenges-content">
            <h1>Profile</h1>
            <p className="challenges-lede">Sign in to keep your submissions, solved problems and streaks.</p>
            <p><a className="button-link primary" href={loginUrl("#/profile")}>Sign in with Google</a></p>
        </main></div>;
    }

    const streak = profile?.streak;
    return (
        <div className="challenges-page">
            <main className="challenges-content profile-page" aria-labelledby="profile-title">
                <header className="profile-head">
                    {user?.avatar_url
                        ? <img className="profile-avatar" src={user.avatar_url} alt="" referrerPolicy="no-referrer" />
                        : <span className="profile-avatar avatar-initial" aria-hidden="true">{user?.name?.[0] ?? "?"}</span>}
                    <div>
                        <h1 id="profile-title">{user?.name ?? "Profile"}</h1>
                        {user?.email && <p className="challenges-lede">{user.email}</p>}
                    </div>
                </header>

                <ImportOffer user={user} onDone={() => { onAccountChange?.(); setVersion((v) => v + 1); }} />
                {error && <ErrorMessage error={error} />}
                {!profile && !error && <p className="challenge-loading">Loading your progress…</p>}

                {profile && <>
                    <section className="profile-stats" aria-label="Summary">
                        <Stat label="Solved" value={`${profile.solved} / ${profile.total}`}
                            detail={profile.imported_solved ? `${profile.imported_solved} imported` : null} />
                        <Stat label="Current streak" value={`${streak.current} ${streak.current === 1 ? "day" : "days"}`}
                            detail={streak.current > 0 && !streak.active_today ? "Solve one today to keep it" : null} />
                        <Stat label="Longest streak" value={`${streak.longest} ${streak.longest === 1 ? "day" : "days"}`} />
                    </section>

                    <section className="submission-section" aria-labelledby="difficulty-heading">
                        <h2 id="difficulty-heading">Solved by difficulty</h2>
                        <ul className="difficulty-bars">
                            {DIFFICULTIES.filter((level) => profile.by_difficulty[level]).map((level) => {
                                const { solved, total } = profile.by_difficulty[level];
                                return (
                                    <li key={level}>
                                        <span className="difficulty-name"><DifficultyBadge difficulty={level} /></span>
                                        <span className={`difficulty-bar difficulty-bar-${level}`} aria-hidden="true">
                                            <span style={{ width: `${total ? (solved / total) * 100 : 0}%` }} />
                                        </span>
                                        <span className="difficulty-count">{solved} / {total} {difficultyLabel(level).toLowerCase()}</span>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>

                    <section className="submission-section" aria-labelledby="unsolved-heading">
                        <h2 id="unsolved-heading">Attempted, not yet solved</h2>
                        {profile.attempted_unsolved.length === 0
                            ? <p className="history-empty">Nothing waiting: every problem you tried is solved.</p>
                            : <ul className="unsolved-list">
                                {profile.attempted_unsolved.map((problem) => (
                                    <li key={problem.slug}>
                                        <a href={`#/problems/${problem.slug}`}>{problem.title}</a>
                                        <DifficultyBadge difficulty={problem.difficulty} />
                                        <span className="history-time">
                                            {problem.attempts ? `${problem.attempts} ${problem.attempts === 1 ? "attempt" : "attempts"}` : "imported"}
                                        </span>
                                    </li>
                                ))}
                            </ul>}
                    </section>

                    <section className="submission-section" aria-labelledby="recent-heading">
                        <h2 id="recent-heading">Recent submissions</h2>
                        {profile.recent.length === 0
                            ? <p className="history-empty">No submissions yet. <a href="#/problems">Pick a challenge</a> to start.</p>
                            : <div className="reference-table history-table">
                                <table>
                                    <thead>
                                        <tr><th scope="col">Problem</th><th scope="col">Verdict</th><th scope="col">Performance</th><th scope="col">Medal</th><th scope="col">When</th></tr>
                                    </thead>
                                    <tbody>
                                        {profile.recent.map((row) => (
                                            <tr key={row.id}>
                                                <th scope="row"><a href={`#/submissions/${row.id}`}>{row.title}</a></th>
                                                <td><VerdictText submission={row} /></td>
                                                <td className="history-metrics">{metricsText(row)}</td>
                                                <td>{row.medal ? <MedalBadge medal={row.medal}>{medalLabel(row.medal)}</MedalBadge> : "—"}</td>
                                                <td className="history-time">{relativeTime(row.created_at)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>}
                        <p className="profile-footnote">Streaks count days with at least one accepted submission, in your time zone ({profile.time_zone}).</p>
                    </section>
                </>}
            </main>
        </div>
    );
}
