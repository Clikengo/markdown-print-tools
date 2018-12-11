import * as MarkdownIt from 'markdown-it';
import * as path from 'path';
import renderPdf from 'paginate-html-to-pdf';
import {mdkatex} from './katex';

function option<T>(value: T | undefined, defaultValue: T) : T {
    if (value === undefined)
        return defaultValue;
    return value;
}

export default async function renderMarkdownPdf(options: {
    markdown_content: string,
    markdown_path: string,
    styles?: string[],
    breaks?: boolean,
    linkify?: boolean,
    toc_levels?: (1 | 2 | 3 | 4 | 5 | 6)[],

    raw_html?: boolean,
    html?: boolean,
    debug?: boolean,
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
    md.use(mdkatex);

    console.info("Markdown to html");
    let body = md.render(options.markdown_content);
    if (options.raw_html)
        return Buffer.from(body, "utf8");
    return renderPdf({
        body,
        base_path: options.markdown_path,
        styles: [
            path.join(__dirname, "../node_modules/katex/dist/katex.css"),
            ...(options.styles || [])
        ],
        html: options.html,
        debug: options.debug,
    });
}
