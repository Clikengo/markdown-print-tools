import * as puppeteer from 'puppeteer';
import * as path from 'path';
import * as fs from 'fs';
import {promisify} from 'util';
import paginate, {Page} from 'paginate-dom';

function to_web_uri(absolute_path: string) {
    if (/[a-z]+:\/\//.test(absolute_path))
        return absolute_path;
    return `file:///${absolute_path.replace(/\\/g, '/')}`;
}

const MB = 1 << 20;
class PDFWStreamForBuffer
{
    private _position = 0;
    data: Buffer;

    constructor(capacity: number = 0) {
        this.data = Buffer.alloc(Math.max(capacity | 0, 1 * MB));
    }

    write(bytes: number[]) {
        let next_pos = this._position + bytes.length;
        if (next_pos > this.data.length) {
            let growth_rate = Math.min(this.data.length, 32 * MB);
            let capacity = Math.ceil(next_pos / growth_rate) * growth_rate;
            console.info(`reallocated from ${this.data.length / MB}MB to ${capacity / MB}MB > ${next_pos / MB}MB `)
            let data = Buffer.alloc(capacity);
            data.set(this.data.subarray(0, this._position), 0);
            this.data = data;
        }
        this.data.set(bytes, this._position);
        this._position = next_pos;
        return bytes.length;
    }

    getData() {
        return this.data.slice(0, this.getCurrentPosition());
    }

    getCurrentPosition() {
        return this._position;
    }

    close(callback: () => void) {
        callback();
    }

}

export default async function renderPdf(options: {
    body: string,
    base_path: string,
    styles?: string[],
}) : Promise<Buffer> {
    let body = options.body;
    let html = `<!DOCTYPE html>
<html>
    <head>
        <base href="${to_web_uri(options.base_path)}">
        <script>
            ${paginate.toString()}
            async function fix_svg() {
                // workaround svg print bugs
                for (let svg_el of document.querySelectorAll('img[src$=".svg"i]')) {
                    if (svg_el.src.startsWith('file:///')) {
                        let data = await load_svg(svg_el.src);
                        let svg_virtual = document.createElement('div');
                        svg_virtual.innerHTML = data;
                        let svg = svg_virtual.firstElementChild;
                        for (let g of svg.querySelectorAll('g')) {
                            let opacity = g.style.opacity;
                            if (opacity) {
                                for (let child of g.children) {
                                    if (child.style && !child.style.opacity)
                                        child.style.opacity = opacity;
                                }
                                g.style.removeProperty("opacity");
                            }
                        }
                        let blob = new Blob([svg.outerHTML], {type : 'image/svg+xml' });
                        let url = URL.createObjectURL(blob);
                        svg_el.src = url;
                        await new Promise((resolve, reject) => {
                            svg_el.onload = resolve;
                            svg_el.onerror = reject;
                        });
                    }
                }
            }
            async function pdf_chunks() {
                await fix_svg();
                let pages = paginate();
                let toc_marks = [];
                let chunks = [];
                for (let [page_idx, { paper, container }] of pages.entries()) {
                    let chunk = chunks[chunks.length - 1];
                    if (!chunk || JSON.stringify(chunk.paper) !== JSON.stringify(paper))
                        chunks.push(chunk = { paper, containers: [] });
                    chunk.containers.push(container);
                    container.style.display = "none";
                    for (let el of container.querySelectorAll("h2, h3, h4")) {
                        toc_marks.push({ title: el.textContent, page_idx, tagName: el.tagName });
                    }
                }
                for (let { paper, containers } of chunks) {
                    for (let container of containers)
                        container.style.display = "";
                    await pdf(paper);
                    for (let container of containers)
                        container.style.display = "none";
                }
                await toc(toc_marks);
            }
        </script>
        <link rel="stylesheet" type="text/css" href="${to_web_uri(path.join(__dirname, "../node_modules/paginate-dom/base.css"))}">
        ${(options.styles || []).map(style => `
        <link rel="stylesheet" type="text/css" href="${to_web_uri(style)}">`).join("")}
    </head>
    <body>
        ${body}
    </body>
</html>`;
    const browser = await puppeteer.launch();
    try {
        console.info("Loading html");
        const page = await browser.newPage();
        let pdf_chunks: Buffer[] = [];
        let toc: Outline[] = [];
        await page.exposeFunction('pdf', async ({ format, margin, orientation }: Page["paper"]) => {
            let options: Parameters<typeof page.pdf>[0] = {
                displayHeaderFooter: false,
                printBackground: true,
                landscape: orientation === "landscape",
                margin,
            };
            if (typeof format === "string")
                options.format = format as puppeteer.PDFFormat;
            else {
                options.height = format.height;
                options.width = format.width;
            }
            console.info(`Creating pdf chunk ${format} ${orientation}`);
            pdf_chunks.push(await page.pdf(options));
        });
        await page.exposeFunction('toc', async (toc_marks: { title: string, page_idx: number, tagName: string }[]) => {
            let stack: [number, Outline][] = [];
            for (let { title, page_idx, tagName } of toc_marks) {
                let lvl = +tagName.substring(1);
                while (stack.length && stack[stack.length - 1][0] >= lvl)
                    stack.pop();
                let outline = { title, page_idx, };
                if (stack.length === 0)
                    toc.push(outline);
                else {
                    let top = stack[stack.length - 1][1];
                    if (!top.childs)
                        top.childs = [];
                    top.childs.push(outline);
                }
                stack.push([lvl, outline]);
            }
        });
        await page.exposeFunction('load_svg', async (svg: string) => {
            if (!svg.startsWith('file:///'))
                return Promise.reject('load_svg expect a file:/// uri');
            svg = svg.substring('file:///'.length);
            let svg_data = await promisify(fs.readFile)(svg, "utf8");
            return svg_data;
        });
        await page.goto(to_web_uri(path.join(__dirname, "../blank.html")));
        await page.emulateMedia('print');
        await page.setContent(html);

        console.info("Creating pages");
        await page.evaluate(`pdf_chunks()`);

        console.info("Writing pdf");
        if (pdf_chunks.length === 0) {
            throw new Error(`nothing to print to pdf`);
        }
        else {
            const hummus = require('hummus');
            let wbuffer = new PDFWStreamForBuffer(pdf_chunks.reduce<number>((p, c) => p + c.length, 0) * 1.25);
            let w = hummus.createWriter(wbuffer);
            let ctx = w.getObjectsContext();
            let events = w.getEvents();

            let page_ids: number[] = [];
            let combined_dests: ((d: any) => (() => void))[] = [];
            for (let pdf_chunk of pdf_chunks)
                copyPages(page_ids, combined_dests, w, new hummus.PDFRStreamForBuffer(pdf_chunk));

            let outline = writeOutline(ctx, toc, page_ids);
            let dests: number | null = null;
            if (combined_dests.length) {
                dests = ctx.startNewIndirectObject();
                let d = ctx.startDictionary();
                let pendings: (() => void)[] = [];
                for (let combined_dest of combined_dests)
                    pendings.push(combined_dest(d));
                ctx.endDictionary(d);
                ctx.endIndirectObject();
                for (let pending of pendings)
                    pending();
            }
            events.on('OnCatalogWrite', (e: any) => {
                let d = e.catalogDictionaryContext;
                if (outline !== null) {
                    d.writeKey("Outlines");
                    d.writeObjectReferenceValue(outline);
                    d.writeKey("PageMode");
                    d.writeNameValue("UseOutlines");
                }
                if (dests !== null) {
                    d.writeKey("Dests");
                    d.writeObjectReferenceValue(dests);
                }
            });

            w.end();
            return wbuffer.getData();
        }
    }
    finally {
        browser.close();
    }
}

function copyPages(page_ids: number[], combined_dests: ((d: any) => (() => void))[], w: any, src: any) {
    let ctx = w.createPDFCopyingContext(src);
    let parser = ctx.getSourceDocumentParser();

    for (let i = 0; i < parser.getPagesCount(); i++) {
        let page_dict = parser.parsePageDictionary(i);
        let src_page_id = parser.getPageObjectID(i);
        let reffed_objects: number[] = [];
        if (page_dict.exists('Annots')) {
            w.getEvents().once('OnPageWrite', function ({ pageDictionaryContext: d }: any) {
                d.writeKey('Annots');
                reffed_objects = ctx.copyDirectObjectWithDeepCopy(page_dict.queryObject('Annots'))
            })
        }
        let page_id  = ctx.appendPDFPageFromPDF(i); // write page. this will trigger the event
        page_ids.push(page_id);
        ctx.replaceSourceObjects({ [src_page_id]: page_id });

        if (reffed_objects.length > 0)
            ctx.copyNewObjectsForDirectObject(reffed_objects)
    }

    let catalog = parser.queryDictionaryObject(parser.getTrailer(), 'Root');
    let dests = catalog && parser.queryDictionaryObject(catalog, 'Dests');
    if (dests) {
        combined_dests.push((d: any) => {
            let reffed_objects: number[] = [];
            for (let [key, value] of Object.entries(dests.toJSObject())) {
                d.writeKey(key);
                reffed_objects.push(...ctx.copyDirectObjectWithDeepCopy(value));
            }
            return () => ctx.copyNewObjectsForDirectObject(reffed_objects);
        });
    }
}

type Outline = { title: string, page_idx: number, childs?: Outline[] };
function writeOutline(ctx: any, outlines: Outline[], page_ids: number[]) : number | null
{
    if (outlines.length === 0)
        return null;

    let outline = ctx.allocateNewObjectID();
    let outline_ids = writeOutlines(ctx, outlines, outline, page_ids);
    ctx.startNewIndirectObject(outline);
    let d = ctx.startDictionary();
    d.writeKey("Type");
    d.writeNameValue("Outlines");
    d.writeKey("Count");
    d.writeNumberValue(outline_ids.length);
    d.writeKey("First");
    d.writeObjectReferenceValue(outline_ids[0]);
    d.writeKey("Last");
    d.writeObjectReferenceValue(outline_ids[outline_ids.length - 1]);
    ctx.endDictionary(d);
    ctx.endIndirectObject();
    return outline;
}
function writeOutlines(ctx: any, outlines: Outline[], parent: number, page_ids: number[]) : number[]
{
    let ids = outlines.map(() => ctx.allocateNewObjectID());
    outlines.forEach(({ title, page_idx, childs }, i) => {
        let id = ids[i];
        let child_ids = childs && childs.length ? writeOutlines(ctx, childs, id, page_ids) : null;
        ctx.startNewIndirectObject(id);
        let d = ctx.startDictionary();

        d.writeKey("Title");
        d.writeLiteralStringValue(title);

        d.writeKey("Parent");
        d.writeObjectReferenceValue(parent);

        d.writeKey("Dest");
        ctx.startArray();
        ctx.writeIndirectObjectReference(page_ids[page_idx]);
        ctx.writeName("XYZ");
        let c = ctx.startFreeContext();
        c.write([ 32, 110, 117, 108, 108, 32, 110, 117, 108, 108, 32, 48, 32 ]/*" null null 0 "*/);
        ctx.endFreeContext();
        ctx.endArray();
        ctx.endLine();

        if (child_ids) {
            d.writeKey("Count");
            d.writeNumberValue(outlines.length);
            d.writeKey("First");
            d.writeObjectReferenceValue(child_ids[0]);
            d.writeKey("Last");
            d.writeObjectReferenceValue(child_ids[child_ids.length - 1]);
        }

        if (i + 1 < ids.length) {
            d.writeKey("Next");
            d.writeObjectReferenceValue(ids[i + 1]);
        }

        if (i > 0) {
            d.writeKey("Prev");
            d.writeObjectReferenceValue(ids[i - 1]);
        }

        ctx.endDictionary(d);
        ctx.endIndirectObject();
    });
    return ids;
}
