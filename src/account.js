// The signed-in account: who it is, signing in and out, and the account API.
import { requestJson } from "./challenges/problems.js";

// The URL that signs in with Google and comes back to `hash` (a route such
// as "#/problems/sum-to-n"). The server only accepts routes of this app.
export function loginUrl(hash = "#/problems") {
    const route = hash.startsWith("#/") ? hash : "#/problems";
    return `/auth/login?next=${encodeURIComponent(`/${route}`)}`;
}

// An error sent back by a failed sign-in, read from the route's query.
export function loginErrorFrom(hash) {
    const query = hash.split("?")[1];
    if (!query) return null;
    return new URLSearchParams(query).get("login_error");
}

export async function fetchMe(signal) {
    return requestJson("/api/me", { signal });
}

export async function logout() {
    await fetch("/auth/logout", { method: "POST", headers: { "Content-type": "application/json" } });
}

export const accountApi = {
    submit: (slug, code) => requestJson(`/problems/${encodeURIComponent(slug)}/submit`, { body: { code } }),
    submission: (id, signal) => requestJson(`/api/submissions/${encodeURIComponent(id)}`, { signal }),
    history: (slug, signal) => requestJson(`/api/problems/${encodeURIComponent(slug)}/submissions`, { signal }),
    progress: (signal) => requestJson("/api/progress", { signal }),
    profile: (timeZone, signal) => requestJson(`/api/profile?tz=${encodeURIComponent(timeZone)}`, { signal }),
    draft: (slug, signal) => requestJson(`/api/drafts/${encodeURIComponent(slug)}`, { signal }),
    saveDraft: (slug, code) => requestJson(`/api/drafts/${encodeURIComponent(slug)}`, { body: { code }, method: "PUT" }),
    importLocal: (payload) => requestJson("/api/import", { body: payload }),
};
