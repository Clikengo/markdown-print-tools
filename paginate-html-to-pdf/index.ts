import * as puppeteer from 'puppeteer';
import * as path from 'path';
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
            async function pdf_chunks() {
                let pages = paginate();
                let chunks = [];
                for (let { paper, container } of pages) {
                    let chunk = chunks[chunks.length - 1];
                    if (!chunk || JSON.stringify(chunk.paper) !== JSON.stringify(paper))
                        chunks.push(chunk = { paper, containers: [] });
                    chunk.containers.push(container);
                    container.style.display = "none";
                }
                for (let { paper, containers } of chunks) {
                    for (let container of containers)
                        container.style.display = "";
                    await pdf(paper);
                    for (let container of containers)
                        container.style.display = "none";
                }
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
        console.info("Loading markdown html");
        const page = await browser.newPage();
        let pdf_chunks: Buffer[] = [];
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
        await page.goto(to_web_uri(path.join(__dirname, "../blank.html")));
        await page.emulateMedia('print');
        await page.setContent(html);

        console.info("Creating pages");
        await page.evaluate(`pdf_chunks()`);

        console.info("Writing pdf");
        if (pdf_chunks.length === 0) {
            throw new Error(`nothing to print to pdf`);
        }
        else if (pdf_chunks.length === 1) {
            return pdf_chunks[0];
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

