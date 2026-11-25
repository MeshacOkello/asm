import { parseBlocks, parseInline } from "../challenges/markdown";

function Inline({ text }) {
    return parseInline(text).map((part, index) => {
        if (part.type === "code") return <code key={index}>{part.text}</code>;
        if (part.type === "strong") return <strong key={index}>{part.text}</strong>;
        if (part.type === "em") return <em key={index}>{part.text}</em>;
        return part.text;
    });
}

// A problem statement. Headings start at h3: the page has its own h1, and the
// statement panel's sections sit under it.
export default function Markdown({ text }) {
    return parseBlocks(text).map((block, index) => {
        if (block.type === "heading") {
            const Heading = `h${Math.min(block.level + 2, 6)}`;
            return <Heading key={index}><Inline text={block.text} /></Heading>;
        }
        if (block.type === "code") {
            return <pre key={index} className="statement-code"><code>{block.text}</code></pre>;
        }
        if (block.type === "list") {
            return <ul key={index}>{block.items.map((item, position) => (
                <li key={position}><Inline text={item} /></li>
            ))}</ul>;
        }
        return <p key={index}><Inline text={block.text} /></p>;
    });
}
