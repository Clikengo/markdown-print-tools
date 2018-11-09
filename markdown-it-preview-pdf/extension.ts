'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {MarkdownIt} from "markdown-it";

export function activate(context: vscode.ExtensionContext) {
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
            let res = texmath_render.call(this, tex, isblock);
            if (align !== "center")
                res = res.replace(/class="katex-display"/, `class="katex-display katex-align-${align}"`);
            return res;
        }
        texmath_once = () => texmath;
        return texmath;
    };

    return {
        extendMarkdownIt(md: MarkdownIt) {
            md.use(require("markdown-it-footnote"));
            md.use(require("markdown-it-sup"));
            md.use(require("markdown-it-sub"));
            md.use(require("markdown-it-anchor"));
            md.use(require("markdown-it-task-lists"));
            md.use(require("markdown-it-table-of-contents"), { includeLevel: [2, 3, 4] });
            md.use(texmath_once(), {delimiters: "dollars" });
            return md;
        }
    }
}

// this method is called when your extension is deactivated
export function deactivate() {
}
