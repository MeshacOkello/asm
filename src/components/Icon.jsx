// Small line icons drawn in the current text colour.
const PATHS = {
    copy: "M8 8h11v13H8z M5 16H4V3h11v1",
    check: "M5 12.5l4.5 4.5L19 7.5",
    open: "M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6",
    back: "M19 12H5 M11 6l-6 6 6 6",
    file: "M14 3H6v18h12V7z M14 3v4h4 M9 12h6 M9 16h6",
    history: "M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 7v5l3 3",
    code: "M8 7l-5 5 5 5 M16 7l5 5-5 5",
    terminal: "M4 6l6 6-6 6 M12 18h8",
    checkbox: "M4 4h16v16H4z M8 12l3 3 5-6",
    play: "M7 5l12 7-12 7z",
    reset: "M4 12a8 8 0 1 0 2.4-5.7 M4 4v5h5",
    chart: "M4 20V10 M10 20V4 M16 20v-8 M22 20H2",
    close: "M6 6l12 12 M18 6L6 18",
    cpu: "M7 7h10v10H7z M10 3v4 M14 3v4 M10 17v4 M14 17v4 M3 10h4 M3 14h4 M17 10h4 M17 14h4",
    memory: "M3 8h18v8H3z M7 8v8 M11 8v8 M15 8v8 M6 16v3 M18 16v3",
    link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
};

export default function Icon({ name, size = 16 }) {
    return (
        <svg className={`icon icon-${name}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
            <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
