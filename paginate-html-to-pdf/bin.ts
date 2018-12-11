#!/usr/bin/env node

import * as program from 'commander';
import {readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import renderPdf from './index';

function collect(val: string, memo: string[]) {
    memo.push(val);
    return memo;
}

program
    .version(require('../package.json').version)
    .usage('[options] <html-file-path>')
    .option('<html-file-path>', 'html body file to convert path')
    .option('-o, --out [path]', 'output PDF path')
    .option('-s, --style <items>', 'CSS style path (can be repeated for multiple styles)', collect, [])
    .parse(process.argv);

if (program.args.length === 0)
    program.help();

let html_path = path.resolve(program.args[0]);
let pdf_path = path.resolve(program.out || `${html_path.replace(/\.\w+$/i, '')}.pdf`);
try {
    renderPdf({
        base_path: html_path,
        body: readFileSync(html_path, 'utf8'),
        styles: program.style.map((s: string) => path.resolve(s)),
    }).then((buffer : Buffer) => writeFileSync(pdf_path, buffer));
} catch(e) {
    console.error(`unable to open html file: ${html_path}: `, e);
}
