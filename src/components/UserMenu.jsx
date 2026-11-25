import { useEffect, useRef, useState } from "react";
import { loginUrl } from "../account";

export function Avatar({ user, className = "avatar" }) {
    const [broken, setBroken] = useState(false);
    if (user.avatar_url && !broken) {
        return <img className={className} src={user.avatar_url} alt="" referrerPolicy="no-referrer"
            onError={() => setBroken(true)} />;
    }
    return <span className={`${className} avatar-initial`} aria-hidden="true">{(user.name || "?")[0].toUpperCase()}</span>;
}

// Signed out: a Sign in link that comes back to the current page.
// Signed in: the avatar, opening a menu with Profile and Log out.
export default function UserMenu({ user, onLogout }) {
    const [open, setOpen] = useState(false);
    const root = useRef(null);
    const button = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const close = (event) => {
            if (event.type === "keydown" && event.key !== "Escape") return;
            if (event.type === "pointerdown" && root.current?.contains(event.target)) return;
            setOpen(false);
            if (event.type === "keydown") button.current?.focus();
        };
        document.addEventListener("pointerdown", close);
        document.addEventListener("keydown", close);
        return () => {
            document.removeEventListener("pointerdown", close);
            document.removeEventListener("keydown", close);
        };
    }, [open]);

    if (user === undefined) return <span className="user-menu" aria-hidden="true" />;
    if (!user) {
        return (
            <div className="user-menu">
                <a className="sign-in-link" href={loginUrl(window.location.hash || "#/problems")}
                    onClick={(event) => { event.currentTarget.href = loginUrl(window.location.hash || "#/problems"); }}>
                    Sign in
                </a>
            </div>
        );
    }
    return (
        <div className="user-menu" ref={root}>
            <button type="button" className="avatar-button" ref={button} aria-haspopup="menu" aria-expanded={open}
                aria-label={`Account: ${user.name}`} onClick={() => setOpen(!open)}>
                <Avatar user={user} />
            </button>
            {open && (
                <div className="user-menu-popover" role="menu">
                    <p className="user-menu-name">{user.name}{user.email && <span>{user.email}</span>}</p>
                    <a role="menuitem" href="#/profile" onClick={() => setOpen(false)}>Profile</a>
                    <button type="button" role="menuitem" onClick={() => { setOpen(false); onLogout(); }}>Log out</button>
                </div>
            )}
        </div>
    );
}
