paginate-html-to-pdf
====================

[![NPM version](http://img.shields.io/npm/v/paginate-html-to-pdf.svg?style=flat)](https://www.npmjs.org/package/paginate-html-to-pdf)

Render an HTML page to pdf with a nice pagination:

 - header and footer generation
 - multiple page orientations and sizes in the same document
 - TOC generation from HTML headings (h1-h6)
 - smart page breaks (tries to keep related stuff in the same page)
 - custom CSS

## Getting started

__Install:__

```
npm install -g paginate-html-to-pdf
```

__Run:__

```
paginate-html-to-pdf my-document.html -o my-document.pdf
```

__Run with custom CSS:__

```
paginate-html-to-pdf my-document.html -o my-document.pdf -s my-document.css -s my-document-extra.css
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

`paper-orientation` can be either:

 - a single value: `2cm` (2cm top, right, bottom and left)
 - a precise value: `1cm 2cm 3cm 25mm` (1cm top, 2cm right, 3cm bottom and 2.5cm left)

### Force page break

You can force a page break by adding a `<hr/>` element.
Don't forget, every occurence of a `<header />` element implies a page break.
