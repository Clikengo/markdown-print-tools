import * as MarkdownIt from 'markdown-it';
import * as path from 'path';
import renderPdf from 'paginate-html-to-pdf';


function option<T>(value: T | undefined, defaultValue: T) : T {
    if (value === undefined)
        return defaultValue;
    return value;
}


let texmath_once = () => {
    const texmath = require("markdown-it-texmath").use(require('katex'));
    const katex_config_rx = /^\s*\{\s*align:\s*(center|left|right)\s*\}/;
    let texmath_render = texmath.render;
    texmath.render = function(tex: string, isblock: boolean) {
        let m = tex.match(katex_config_rx);
        let align = "center";
        if (m) {
            tex = tex.substring(m[0].length);
            align = m[1];
        }
        let res = texmath_render(tex, isblock);
        if (align !== "center")
            res = res.replace(/class="katex-display"/, `class="katex-display katex-align-${align}"`);
        return res;
    }
    texmath_once = () => texmath;
    return texmath;
};

export default async function renderMarkdownPdf(options: {
    markdown_content: string,
    markdown_path: string,
    styles?: string[],
    breaks?: boolean,
    linkify?: boolean,
    toc_levels?: (1 | 2 | 3 | 4 | 5 | 6)[],
}) : Promise<Buffer> {
    let md = new MarkdownIt({
        html: true,
        breaks: option(options.breaks, false),
        linkify: option(options.linkify, true),
    });
    md.use(require("markdown-it-footnote"));
    md.use(require("markdown-it-sup"));
    md.use(require("markdown-it-sub"));
    md.use(require("markdown-it-anchor"));
    md.use(require("markdown-it-task-lists"));
    md.use(require("markdown-it-table-of-contents"), { includeLevel: option(options.toc_levels, [2, 3, 4]) });
    md.use(texmath_once(), {delimiters: "dollars" });

    console.info("Markdown to html");
    let body = md.render(options.markdown_content);
    return renderPdf({
        body,
        base_path: options.markdown_path,
        styles: [
            path.join(__dirname, "../node_modules/katex/dist/katex.css"),
            ...(options.styles || [])
        ],
    });
}
