#!/usr/bin/env node

import * as program from 'commander';
import {readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import renderMarkdownPdf from './index';

function collect(val: string, memo: string[]) {
    memo.push(val);
    return memo;
}

program
    .version(require('../package.json').version)
    .usage('[options] <markdown-file-path>')
    .option('<markdown-file-path>', 'markdown file to convert path')
    .option('-o, --out [path]', 'output PDF path')
    .option('-s, --style <items>', 'CSS style path (can be repeated for multiple styles)', collect, [])
    .option('--raw-html', 'output the raw html (before pagination)')
    .option('--html', 'output the paginated html instead of a pdf')
    .option('--debug', 'pause the generation just after the pagination')
    .parse(process.argv);

if (program.args.length === 0)
    program.help();

let markdown_path = path.resolve(program.args[0]);
let pdf_path = path.resolve(program.out || `${markdown_path.replace(/\.\w+$/i, '')}.${program.html ? "html" : "pdf"}`);
try {
    renderMarkdownPdf({
        markdown_path: markdown_path,
        markdown_content: readFileSync(markdown_path, 'utf8'),
        styles: program.style.map((s: string) => path.resolve(s)),
        raw_html: !!program["raw-html"],
        html: !!program.html,
        debug: !!program.debug,
    }).then((buffer : Buffer) => writeFileSync(pdf_path, buffer));
} catch(e) {
    console.error(`unable to open markdown file: ${markdown_path}`, e);
}
