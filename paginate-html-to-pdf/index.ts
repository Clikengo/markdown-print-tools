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
        await new Promise((resolve, reject) => {
            page.on('load', resolve)
        });

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
            for (let pdf_chunk of pdf_chunks)
                w.appendPDFPagesFromPDF(new hummus.PDFRStreamForBuffer(pdf_chunk));
            w.end();
            return wbuffer.data;
        }
    }
    finally {
        browser.close();
    }
}
