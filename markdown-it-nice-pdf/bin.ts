#!/usr/bin/env node

import * as program from 'commander';
import {readFileSync, writeFileSync } from 'fs';
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
    .parse(process.argv);

if (program.args.length === 0)
    program.help();

let markdown_path = program.args[0];
let pdf_path = program.out || `${markdown_path.replace(/\.\w+$/i, '')}.pdf`;
try {
    renderMarkdownPdf({
        markdown_path: markdown_path,
        markdown_content: readFileSync(markdown_path, 'utf8'),
        styles: program.style,
    }).then((buffer : Buffer) => writeFileSync(pdf_path, buffer));
} catch(e) {
    console.error(`unable to open markdown file: ${markdown_path}`, e);
}
