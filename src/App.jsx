import { useEffect, useRef, useState } from "react";
import AssemblyVisualizer from "./components/AssemblyVisualizer";
import HowToUse from "./components/HowToUse";
import AppHeader from "./components/AppHeader";
import ChallengeList from "./components/ChallengeList";
import ChallengeWorkspace from "./components/ChallengeWorkspace";
import SubmissionRedirect from "./components/SubmissionRedirect";
import ProfilePage from "./components/ProfilePage";
import { fetchMe, logout } from "./account";
import { routeFrom } from "./routes";
import { applyTheme, initialTheme } from "./theme";
import './App.css';

const TITLES = {
    guide: "How to use · Assembly Visualizer",
    challenges: "Challenges · Assembly Visualizer",
    challenge: "Challenges · Assembly Visualizer",
    submission: "Submission · Assembly Visualizer",
    profile: "Profile · Assembly Visualizer",
    visualizer: "Assembly Visualizer",
};

const NAV = {
    guide: "guide", challenges: "challenges", challenge: "challenges", submission: "challenges",
    profile: "profile", visualizer: "visualizer",
};

export default function App() {
    const [route, setRoute] = useState(() => routeFrom(window.location.hash));
    const workspace = useRef(null);
    const [addressFormat, setAddressFormat] = useState("hex");
    const [dataFormat, setDataFormat] = useState("dec");
    const formats = { address: addressFormat, data: dataFormat };
    // One editor theme for every page that shows an editor.
    const [theme, setTheme] = useState(initialTheme);
    // undefined while the session is being checked, then null or the user.
    const [user, setUser] = useState(undefined);
    const [account, setAccount] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        fetchMe(controller.signal)
            .then((data) => setUser(data.user))
            .catch((failure) => {
                if (failure?.name !== "AbortError") setUser(null);
            });
        return () => controller.abort();
    }, [account]);

    async function signOut() {
        await logout().catch(() => {});
        setUser(null);
    }

    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    useEffect(() => {
        const update = () => setRoute(routeFrom(window.location.hash));
        window.addEventListener("hashchange", update);
        return () => window.removeEventListener("hashchange", update);
    }, []);

    useEffect(() => {
        document.title = TITLES[route.page];
    }, [route.page, route.slug]);

    function openExample(example) {
        workspace.current.openProgram(example.source, example.title);
        window.location.hash = "#/";
    }

    function openChallengeTest({ source, title, stdin }) {
        workspace.current.openProgram(source, title, { stdin });
        window.location.hash = "#/";
    }

    const hasUnsavedCode = (source) => workspace.current?.hasUnsavedCode(source) ?? false;

    return (
        <>
            <AppHeader current={NAV[route.page]} user={user} onLogout={signOut} showFormats={route.page === "visualizer"}
                formats={formats} onAddressFormatChange={setAddressFormat} onDataFormatChange={setDataFormat} />
            {/* Kept mounted while another page shows, so the code, the run and
                the selected step are all still there on the way back. */}
            <div hidden={route.page !== "visualizer"}>
                <AssemblyVisualizer ref={workspace} active={route.page === "visualizer"} formats={formats}
                    theme={theme} onThemeChange={setTheme} />
            </div>
            {route.page === "guide" && (
                <HowToUse
                    section={route.section}
                    hasUnsavedCode={hasUnsavedCode}
                    onOpenExample={openExample}
                />
            )}
            {route.page === "challenges" && (
                <ChallengeList user={user} onAccountChange={() => setAccount((n) => n + 1)} />
            )}
            {route.page === "challenge" && (
                <ChallengeWorkspace key={route.slug} slug={route.slug} tab={route.tab} submissionId={route.id ?? null}
                    user={user} formats={formats}
                    theme={theme} onThemeChange={setTheme}
                    hasUnsavedCode={hasUnsavedCode} onOpenInVisualizer={openChallengeTest} />
            )}
            {route.page === "submission" && (
                <SubmissionRedirect key={route.id} id={route.id} user={user} />
            )}
            {route.page === "profile" && (
                <ProfilePage user={user} onAccountChange={() => setAccount((n) => n + 1)} />
            )}
        </>
    );
}
