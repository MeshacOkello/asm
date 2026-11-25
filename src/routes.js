import { SECTIONS } from "./guide/sections.js";

// "#/how-to" and "#/how-to/<section>" are the guide; "#/problems",
// "#/problems/<slug>" and "#/problems/<slug>/submissions" the challenges;
// "#/submissions/<id>" one attempt and "#/profile" the account. Anything else
// is the Visualizer. Hash routes need no server support and keep history.
export function routeFrom(hash) {
    const path = hash.split("?")[0];
    const challenge = /^#\/problems(?:\/([\w-]+)(?:\/(submissions)(?:\/(\d+))?)?)?\/?$/.exec(path);
    if (challenge) {
        if (!challenge[1]) return { page: "challenges", section: null, slug: null };
        const tab = challenge[3] ? "result" : challenge[2] ? "submissions" : "description";
        return { page: "challenge", section: null, slug: challenge[1], tab,
            ...(challenge[3] ? { id: Number(challenge[3]) } : {}) };
    }
    const submission = /^#\/submissions\/(\d+)\/?$/.exec(path);
    if (submission) return { page: "submission", section: null, slug: null, id: Number(submission[1]) };
    if (/^#\/profile\/?$/.test(path)) return { page: "profile", section: null, slug: null };
    const match = /^#\/how-to(?:\/([\w-]+))?\/?$/.exec(hash);
    if (!match) return { page: "visualizer", section: null, slug: null };
    const section = SECTIONS.some(({ id }) => id === match[1]) ? match[1] : null;
    return { page: "guide", section, slug: null };
}
