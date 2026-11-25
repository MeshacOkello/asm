import { useEffect, useRef, useState } from "react";
import AssemblyVisualizer from "./components/AssemblyVisualizer";
import HowToUse from "./components/HowToUse";
import AppHeader from "./components/AppHeader";
import ChallengeList from "./components/ChallengeList";
import ChallengeWorkspace from "./components/ChallengeWorkspace";
import { SECTIONS } from "./guide/sections";
import { applyTheme, initialTheme } from "./theme";
import './App.css';

// "#/how-to" and "#/how-to/<section>" are the guide, "#/problems" and
// "#/problems/<slug>" the challenges; anything else is the Visualizer. Hash
// routes need no server support and keep browser history.
function routeFrom(hash) {
    const challenge = /^#\/problems(?:\/([\w-]+))?\/?$/.exec(hash);
    if (challenge) {
        return challenge[1]
            ? { page: "challenge", section: null, slug: challenge[1] }
            : { page: "challenges", section: null, slug: null };
    }
    const match = /^#\/how-to(?:\/([\w-]+))?\/?$/.exec(hash);
    if (!match) return { page: "visualizer", section: null, slug: null };
    const section = SECTIONS.some(({ id }) => id === match[1]) ? match[1] : null;
    return { page: "guide", section, slug: null };
}

const TITLES = {
    guide: "How to use · Assembly Visualizer",
    challenges: "Challenges · Assembly Visualizer",
    challenge: "Challenges · Assembly Visualizer",
    visualizer: "Assembly Visualizer",
};

const NAV = { guide: "guide", challenges: "challenges", challenge: "challenges", visualizer: "visualizer" };

export default function App() {
    const [route, setRoute] = useState(() => routeFrom(window.location.hash));
    const workspace = useRef(null);
    const [addressFormat, setAddressFormat] = useState("hex");
    const [dataFormat, setDataFormat] = useState("dec");
    const formats = { address: addressFormat, data: dataFormat };
    // One editor theme for every page that shows an editor.
    const [theme, setTheme] = useState(initialTheme);

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
            <AppHeader current={NAV[route.page]}
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
            {route.page === "challenges" && <ChallengeList />}
            {route.page === "challenge" && (
                <ChallengeWorkspace key={route.slug} slug={route.slug} formats={formats}
                    theme={theme} onThemeChange={setTheme}
                    hasUnsavedCode={hasUnsavedCode} onOpenInVisualizer={openChallengeTest} />
            )}
        </>
    );
}
