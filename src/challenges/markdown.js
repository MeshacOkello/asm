// Just enough Markdown for problem statements, parsed into plain data that
// React renders as elements: no HTML strings, so nothing in a statement can
// inject markup. Supported: # to ### headings, paragraphs, ``` fences, "- "
// lists, `code`, **bold** and *emphasis*.

export function parseBlocks(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    let paragraph = [];
    let list = null;

    const flush = () => {
        if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") });
        paragraph = [];
        if (list) blocks.push(list);
        list = null;
    };

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const fence = /^```(\w*)\s*$/.exec(line);
        if (fence) {
            flush();
            const body = [];
            index++;
            while (index < lines.length && !/^```\s*$/.test(lines[index])) body.push(lines[index++]);
            blocks.push({ type: "code", lang: fence[1] || null, text: body.join("\n") });
            continue;
        }
        const heading = /^(#{1,3})\s+(.*)$/.exec(line);
        if (heading) {
            flush();
            blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
            continue;
        }
        const item = /^\s*[-*]\s+(.*)$/.exec(line);
        if (item) {
            if (paragraph.length) {
                blocks.push({ type: "paragraph", text: paragraph.join(" ") });
                paragraph = [];
            }
            list ??= { type: "list", items: [] };
            list.items.push(item[1].trim());
            continue;
        }
        if (!line.trim()) {
            flush();
            continue;
        }
        if (list && /^\s+\S/.test(line)) {
            // A continuation line of the current list item.
            list.items[list.items.length - 1] += ` ${line.trim()}`;
            continue;
        }
        if (list) flush();
        paragraph.push(line.trim());
    }
    flush();
    return blocks;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)/g;

export function parseInline(text) {
    const parts = [];
    let last = 0;
    for (const match of text.matchAll(INLINE)) {
        if (match.index > last) parts.push({ type: "text", text: text.slice(last, match.index) });
        const token = match[0];
        if (match[1]) parts.push({ type: "code", text: token.slice(1, -1) });
        else if (match[2]) parts.push({ type: "strong", text: token.slice(2, -2) });
        else parts.push({ type: "em", text: token.slice(1, -1) });
        last = match.index + token.length;
    }
    if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
    return parts;
}
