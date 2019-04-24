paginate-dom
====================

[![NPM version](http://img.shields.io/npm/v/paginate-dom.svg?style=flat)](https://www.npmjs.org/package/paginate-dom)

Paginate an HTML document:

 - header and footer generation
 - multiple page orientations and sizes in the same document
 - TOC generation from HTML headings (h1-h6)
 - smart page breaks (tries to keep related stuff in the same page)
 - easy to embed (one paginate method that is self hosted)

## Getting started

__Install:__

```
npm install paginate-dom
```

__How to use:__

Just call `paginate` in your page. This will paginate your whole page body by default.

__API:__

```ts
export default function paginate(options?: {
    /** element that contains pages to cut, defaults: document.body */
    body?: HTMLElement,

    /** page paper size, defaults: A4 */
    paper?: "A5" | "A4" | "A3" | "B5" | "B4" | "JIS-B5" | "JIS-B4" | "letter" | "legal" | "ledger" | { width: string, height: string },
    /** page paper margin, defaults: 2cm */
    paper_margin?: string | { top: string, right: string, bottom: string, left: string },
    /** page paper orientation, defaults: portrait */
    paper_orientation?: "portrait" | "landscape",

    /** list of element tagName that forcibly cut the page, defaults: ["H1", "H2", "HR"] */
    force_cut_tag_names?: string[],
    /** maximum allowed overcut in mm, defaults: 8cm */
    max_overcut?: string,
    /** minimum allowed height in mm, defaults: 2cm */
    min_height?: string,
    /** force first page element no margin-top, defaults: tagName !== "H1" */
    first_page_element_no_margin_top?: (tagName: string) => boolean,
}) : {
    page: number,
    paper: {
        format: "A5" | "A4" | "A3" | "B5" | "B4" | "JIS-B5" | "JIS-B4" | "letter" | "legal" | "ledger" | { width: string, height: string },
        margin: { top: string, right: string, bottom: string, left: string },
        orientation: "portrait" | "landscape",
    },
    container: HTMLElement,
    header: HTMLElement | null,
    footer: HTMLElement | null,
}[];
```

## Paper configuration, headers and footers

### Headers and footers

By adding a `<header />` and/or a `<footer />` HTML element you set the current and next pages header and footer. You can change header and footer anywhere in your document.

You can refer to some variables:

 - `{{ page }}` is replaced by the current page number
 - `{{ num_pages }}` is replaced by the total number of pages

Example:

```html
<header>
	<img src="top-logo.svg" />
</header>
<footer>
	{{ page }} / {{ num_pages }}
</footer>
```


### Page orientation, size and numbering

Page orientation, size and numbering are controlled by adding the `<header />` HTML element.
You can change orientation, size and numbering as much as you want.
Every occurence of a `<header />` element implies a page break.

Example with default values:

```html
<header page="1" paper="A4" paper-orientation="portrait" paper-margin="2cm">
</header>
```

The document defaults to:

 - paper: A4
 - paper-orientation: portrait
 - paper-margin: 2cm

#### Paper

`paper` can be one of:

 - A5
 - A4
 - A3
 - B5
 - B4
 - JIS-B5
 - JIS-B4
 - letter
 - legal
 - ledger

Or a custom size: `width height`.

#### Paper orientation

`paper-orientation` can be either `portrait` or `landscape`

#### Paper margin

`paper-margin` can be either:

 - a single value: `2cm` (2cm top, right, bottom and left)
 - a precise value: `1cm 2cm 3cm 25mm` (1cm top, 2cm right, 3cm bottom and 2.5cm left)

### Force page break

You can force a page break by adding a `<hr/>` element.
Don't forget, every occurence of a `<header />` element implies a page break.
