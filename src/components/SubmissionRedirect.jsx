import { useEffect, useState } from "react";
import ErrorMessage from "./ErrorMessage";
import { accountApi, loginUrl } from "../account";
import { failureFrom } from "../challenges/problems";

// "#/submissions/<id>" from older links: a submission now opens in its
// problem's workspace, so look up the problem and go there.
export default function SubmissionRedirect({ id, user }) {
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!user) return undefined;
        const controller = new AbortController();
        accountApi.submission(id, controller.signal)
            .then((data) => window.location.replace(`#/problems/${data.slug}/submissions/${id}`))
            .catch((failure) => {
                if (failure?.name !== "AbortError") setError(failureFrom(failure));
            });
        return () => controller.abort();
    }, [id, user]);

    return (
        <div className="challenges-page"><main className="challenges-content">
            {user === null && <>
                <h1>Submission</h1>
                <p className="challenges-lede">Submissions are private. Sign in to see yours.</p>
                <p><a className="button-link primary" href={loginUrl(`#/submissions/${id}`)}>Sign in with Google</a></p>
            </>}
            {error && <ErrorMessage error={error} />}
            {user !== null && !error && <p className="challenge-loading">Opening submission…</p>}
        </main></div>
    );
}
