
type CutNode = { tagName: string, node: Node, top: number, bottom: number };
interface CutPage {
    original_closest: CutNode,
    closest: CutNode,
    outer: CutNode,
    /** elements that will be copied (parents) or moved (closest) to the next page */
    stack: CutNode[],
    page: number,
    num_pages: { num_pages: number },
    header: HTMLElement | null,
    footer: HTMLElement | null,
    top: number,
    /** expected top height of parents when copied to the next page */
    parents_top_height: number,
    expected_page_bottom: number,
    next_expected_page_bottom: number,
}

export interface Page  {
    page: number,
    paper: {
        format: "A5" | "A4" | "A3" | "B5" | "B4" | "JIS-B5" | "JIS-B4" | "letter" | "legal" | "ledger" | { width: string, height: string },
        margin: { top: string, right: string, bottom: string, left: string },
        orientation: "portrait" | "landscape",
    },
    container: HTMLElement,
    header: HTMLElement | null,
    footer: HTMLElement | null,
}

/**
 * Generate <div class="page"> elements for each print page in the body
 * Cutting is done in 3 steps:
 *  - setting body element paper style
 *  - read only computing cuts
 *  - apply cuts to generate <div class="page"> elements
 *
 * You can use <header /> and <footer /> to create a header and footer
 * for each page. You can use the {{ page }} and {{ num_pages }} placeholder
 * to render the current page number and the total number of pages.
 * <header page="N"/> set the current page number.
 * <header paper="A4"/> set the current page paper.
 *
 * This function is self-hosted, this means you can serialize it to string
 */
export default function paginate(options: {
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
    /** force first page element no margin-top, defaults: tagName !== "H1" */
    first_page_element_no_margin_top?: (tagName: string) => boolean,

    /** log page cut informations, defaults: false */
    DEBUG?: boolean,
    /** trace page cut informations, defaults: false */
    TRACE?: boolean,
    /** cut pages with <div class="page"> elements, defaults: true  */
    PAGINATE?: boolean,
} = {}) : Page[] {
    ///////////////
    // Const
    function option<T>(value: T | undefined, defaultValue: T) : T {
        if (value === undefined)
            return defaultValue;
        return value;
    }

    const unit = {
        px: 1,
        cm: 37.79527559055118,
        mm: 3.779527559055118,
        in: 96,
        pc: 16,
        pt: 1.3333333333333333,
    };
    const RX_LENGTH = /^(\d+)(px|cm|mm|in|pc|pt)$/;
    function length_to_px(length: string) : number {
        let m = length.match(RX_LENGTH);
        if (!m)
            throw new Error(`invalid length: ${length}`);
        return (+m[1]) * unit[m[2] as "px"|"cm"|"mm"|"in"|"pc"|"pt"];
    }
    function check_length(length: string) {
        let m = length.match(RX_LENGTH);
        if (!m)
            throw new Error(`invalid length: ${length}`);
        return length;
    }

    const papers = {
        "A5":     { width: "148mm", height: "210mm" },
        "A4":     { width: "210mm", height: "297mm" },
        "A3":     { width: "297mm", height: "420mm" },
        "B5":     { width: "176mm", height: "250mm" },
        "B4":     { width: "250mm", height: "353mm" },
        "JIS-B5": { width: "182mm", height: "257mm" },
        "JIS-B4": { width: "257mm", height: "364mm" },
        "letter": { width: "8.5in", height: "11in"  },
        "legal":  { width: "8.5in", height: "14in"  },
        "ledger": { width: "11in" , height: "17in"  },
    };

    ///////////////
    // Options
    const MAX_OVERCUT = length_to_px(option(options.max_overcut, "8cm"));
    const DEBUG = option(options.DEBUG, false);
    const TRACE = option(options.TRACE, false);
    const PAGINATE = option(options.PAGINATE, true);

    const body = option(options.body, document.body);
    const first_page_element_no_margin_top = option(options.first_page_element_no_margin_top, (tagName: string) => tagName !== "H1");

    ///////////////
    // CONTEXT
    let page = 0;
    let num_pages = { num_pages: 0 };
    let expected_page_bottom: number;
    let header: HTMLElement | null = null;
    let footer: HTMLElement | null = null;
    let cut_elements = new Set<HTMLElement>();
    let last_cutable_tag_name: string = "HEADER";

    ///////////////
    // LIB
    const cut_tag_names = new Set([
        "UL", "OL", "LI",
        "P",
        "PRE", "DIV",
        "TABLE", "TBODY", "TR",
        "SECTION",
        "BLOCKQUOTE",
        "IMG",
        "H1", "H2", "H3", "H4", "H5", "H6",
        "HR",
    ]);
    const force_closest_tag_names = new Set(["PRE"]);
    const force_cut_tag_names = new Set(options.force_cut_tag_names || [
        "H1", "H2",
        "HR",
    ]);

    const always_overcut_tag_names = new Map([
        ["H1",6], ["H2", 5], ["H3", 4], ["H4", 3], ["H5", 2], ["H6", 1]
    ]);


    function parse_paper(paper: string | undefined | null) : typeof options.paper | undefined {
        if (!paper)
            return undefined;
        if (paper in papers)
            return paper as typeof options.paper;
        let [width, height] = paper.split(/\s+/, 2).map(check_length);
        if (width && height)
            return { width, height };
        throw new Error(`invalid paper: ${paper}`);
    }

    function parse_paper_margin(paper_margin: string | undefined | null) : { top: string, right: string, bottom: string, left: string } | undefined {
        if (!paper_margin)
            return undefined;

        let [top, right, bottom, left] = paper_margin.split(/\s+/, 4).map(check_length);
        if (top && right && bottom && left)
            return { top, right, bottom, left };
        if (top && !right && !bottom && !left)
            return  { top: top, right: top, bottom: top, left: top };
        throw new Error(`invalid paper_margin: ${paper_margin}`);
    }


    function parse_paper_orientation(paper_orientation: string | undefined | null) : typeof options.paper_orientation | undefined {
        if (!paper_orientation)
            return undefined;
        if (paper_orientation === "portrait" || paper_orientation === "landscape")
            return paper_orientation;
        throw new Error(`invalid paper_margin: ${paper_orientation}`);
    }

    const WHITESPACE_RX = /^\s*$/;
    function is_text_content_whitespace(text: Text) {
        return WHITESPACE_RX.test(text.wholeText);
    }

    function next_cut_stack(node: Node | null) : CutNode[] {
        let stack: CutNode[] = [];
        while (node) {
            let cut = next_cut(node, expected_page_bottom, stack.length);
            node = null;
            if (cut === true) {
                // node.parentNode.bottom > expected_page_bottom
                // but node.parentNode.firstChild.bottom > expected_page_bottom
                // cut at node.parentNode.nextSibling
                let parent: CutNode | null;
                do {
                    parent = stack.pop() || null;
                    if (TRACE) console.info("cut at node.parentNode.nextSibling", parent);
                } while (parent && !parent.node.nextSibling);
                node = parent && parent.node.nextSibling;
            }
            else if (typeof cut !== "boolean") {
                stack.push(cut);
                if (cut.top < expected_page_bottom && !force_closest_tag_names.has(cut.tagName)) {
                    node = cut.node.firstChild;
                }
            }
        }
        return stack;
    }

    function is_cut_block(tagName: string, lvl: number) : boolean {
        if (DEBUG && lvl === 0 && !cut_tag_names.has(tagName))
            console.info(`consider adding ${tagName} to cut_tag_names at lvl ${lvl}`);
        return cut_tag_names.has(tagName);
    }

    function next_cut(node: Node | null, bot: number, lvl: number) : CutNode | boolean {
        let could_have_cut = false;
        while (node) {
            if (node instanceof HTMLElement) {
                if (node.tagName === "HEADER") {
                    header = node;
                    last_cutable_tag_name = "HEADER";
                    let new_page_num = header.getAttribute("page");
                    if (new_page_num) {
                        page = +new_page_num - 1;
                        num_pages = { num_pages: 0 };
                    }
                }
                else if (node.tagName === "FOOTER") {
                    footer = node;
                }
                else if (is_cut_block(node.tagName, lvl)) {
                    could_have_cut = true;
                    let can_force_cut = last_cutable_tag_name !== "HEADER";
                    let rect = node.getBoundingClientRect();
                    if (TRACE) console.info(`${lvl}! ${rect.bottom} > ${bot}`, node, rect.top, rect.bottom, last_cutable_tag_name);
                    last_cutable_tag_name = node.tagName;
                    if (
                        (
                            rect.bottom > bot ||
                            (
                                lvl === 0 &&
                                force_cut_tag_names.has(node.tagName) &&
                                can_force_cut
                            )
                        ) &&
                        !cut_elements.has(node)
                    ) {
                        cut_elements.add(node);
                        return { tagName: node.tagName, node, top: rect.top, bottom: rect.bottom };
                    }
                }
            }
            node = node.nextSibling;
        }
        return could_have_cut;
    }

    function next_element_sibling(nextSibling: Node | null) : HTMLElement | null {
        while (nextSibling) {
            if (nextSibling instanceof HTMLElement)
                return nextSibling;
            nextSibling = nextSibling.nextSibling;
        }
        return null;
    }

    function previous_element_sibling(previousSibling: Node | null) : HTMLElement | null {
        while (previousSibling) {
            if (previousSibling instanceof HTMLElement)
                return previousSibling;
            previousSibling = previousSibling.previousSibling;
        }
        return null;
    }

    function cut_from_element(el: HTMLElement | null) : CutNode | null {
        if (!el)
            return null;
        let rect = el.getBoundingClientRect();
        return { tagName: el.tagName, node: el, top: rect.top, bottom: rect.bottom };
    }

    function copy_element_empty(element: HTMLElement, mark_cut = true) : HTMLElement {
        let empty_el = document.createElement(element.tagName);
        for (let { name, value } of element.attributes) {
            empty_el.setAttribute(name, value);
        }
        if (mark_cut)
            empty_el.className += " __cut";
        return empty_el;
    }

    function clone_element(element: HTMLElement, variables: { rx: RegExp, by: string }[]): HTMLElement;
    function clone_element(element: HTMLElement | null, variables: { rx: RegExp, by: string }[]): HTMLElement | null;
    function clone_element(element: HTMLElement | null, variables: { rx: RegExp, by: string }[]): HTMLElement | null {
        if (!element)
            return null;
        let c = copy_element_empty(element, false);
        let html = element.innerHTML;
        for (let { rx, by } of variables) {
            html = html.replace(rx, by);
        }
        c.innerHTML = html;
        return c;
    }

    const ENDS_WITH_SEE = /:\s*$/;
    function fix_weird_cut_positions(closest: CutNode, expected_page_bottom: number): CutNode {
        let last_closest: CutNode;
        do {
            last_closest = closest;
            let cTagName = closest.tagName;
            let previous_available_cut = cut_from_element(previous_element_sibling(closest.node.previousSibling));
            if (!previous_available_cut)
                break;
            let previous_always_cut: CutNode | null = previous_available_cut;
            let always_cut_order = always_overcut_tag_names.get(cTagName) || 0;
            do {
                if ((expected_page_bottom - previous_always_cut.top) > MAX_OVERCUT)
                    previous_always_cut = null;
                else if ((always_overcut_tag_names.get(previous_always_cut.tagName) || 0) > always_cut_order)
                    break;
                else
                    previous_always_cut = cut_from_element(previous_element_sibling(previous_always_cut.node.previousSibling));
            } while (previous_always_cut);

            if (previous_always_cut) {
                // no cut just after headers
                closest = previous_available_cut;
            }
            else {
                let pTagName = previous_available_cut.tagName;
                let overcut = expected_page_bottom - previous_available_cut.top;
                if (DEBUG) console.info(cTagName, pTagName, `${overcut} < ${MAX_OVERCUT}`);
                if (overcut < MAX_OVERCUT && pTagName === "P" && ENDS_WITH_SEE.test(previous_available_cut.node.textContent!)) {
                    // keep the paragraph before UL or OL
                    closest = previous_available_cut;
                }
                else if (cTagName === "TBODY" && pTagName === "THEAD") {
                    // no cut on the first raw
                    closest = previous_available_cut;
                }
            }
            if (DEBUG && last_closest !== closest)
                console.info(`replaced`, last_closest, "by", closest);
        } while (last_closest !== closest);
        return closest;
    }

    function table_thead(element: HTMLElement) : HTMLElement | null {
        if (element.tagName === "TABLE") {
            let thead = element.firstElementChild;
            if (thead && thead.tagName === "THEAD")
                return thead as HTMLElement;
        }
        return null;
    }

    function structure_top_height(stack: CutNode[], outer: CutNode, closest: CutNode) {
        let parents_top_height = 0;

        if (outer.node instanceof HTMLElement && !first_page_element_no_margin_top(outer.node.tagName)) {
            let style = window.getComputedStyle(outer.node);
            parents_top_height += parseFloat(style.marginTop!);
        }
        for (let brk of stack) {
            if (brk !== closest) {
                let firstElement = next_element_sibling(brk.node.firstChild);
                if (firstElement) {
                    if (!first_page_element_no_margin_top(firstElement.tagName)) {
                        let firstElementRect = firstElement.getBoundingClientRect();
                        parents_top_height += Math.max(0, firstElementRect.top - brk.top);
                    }
                    let thead = table_thead(firstElement);
                    if (thead)
                        parents_top_height += thead.getBoundingClientRect().height;
                }
            }
        }
        return parents_top_height;
    }

    function create_containers() {
        let containers: {
            container: HTMLElement,
            paper: NonNullable<typeof options.paper>,
            paper_str: string,
            paper_size: { width: string, height: string },
            paper_margin: { top: string, right: string, bottom: string, left: string },
            paper_orientation: NonNullable<typeof options.paper_orientation>,
            page?: number,
            first: { page: number, num_pages: { num_pages: number }, header: HTMLElement | null, footer: HTMLElement | null },
            cuts: CutPage[],
        }[] = [];
        let container: HTMLElement | null = null;
        let paper = option(options.paper, "A4");
        let paper_margin = option(options.paper_margin, "2cm");
        let paper_orientation = option(options.paper_orientation, "portrait");
        if (typeof paper_margin === "string")
            paper_margin= { top: paper_margin, right: paper_margin, bottom: paper_margin, left: paper_margin };

        for (let node of [...body.childNodes]) {
            let tagName = node instanceof HTMLElement ? node.tagName : node.nodeName;
            if (tagName === "SCRIPT")
                continue;
            if (!container && node instanceof Text && is_text_content_whitespace(node))
                continue;
            if (!container || tagName === "HEADER") {
                let isHeader = tagName === "HEADER";
                paper = option(isHeader ? parse_paper((node as HTMLElement).getAttribute("paper")) : undefined, paper);
                paper_margin = option(isHeader ? parse_paper_margin((node as HTMLElement).getAttribute("paper-margin")) : undefined, paper_margin);
                paper_orientation = option(isHeader ? parse_paper_orientation((node as HTMLElement).getAttribute("paper-orientation")) : undefined, paper_orientation);
                let paper_size = typeof paper !== "object" ? papers[paper as keyof typeof papers] : paper;
                let paper_str = typeof paper === "object" ? `${paper.width} ${paper.height}` : paper;
                container = document.createElement("DIV");
                container.className = "__container";
                container.style.boxSizing = "border-box";
                container.style.width = paper_orientation === "portrait" ? paper_size.width : paper_size.height;
                container.style.paddingTop = typeof paper_margin === "object" ? paper_margin.top : paper_margin;
                container.style.paddingRight = typeof paper_margin === "object" ? paper_margin.right : paper_margin;
                container.style.paddingBottom = typeof paper_margin === "object" ? paper_margin.bottom : paper_margin;
                container.style.paddingLeft = typeof paper_margin === "object" ? paper_margin.left : paper_margin;
                let first = { page: -1, num_pages: { num_pages: 0 }, header: null, footer: null };
                containers.push({ container, paper, paper_size, paper_str, paper_margin, paper_orientation, first, cuts: [] });
            }
            container.appendChild(node);
        }
        return containers;
    }

    function create_pages({ container, paper, paper_str, paper_margin, paper_orientation, first, cuts }: ReturnType<typeof create_containers>[0]) {
        for (let { header, footer } of cuts) {
            if (header && header.parentNode)
                header.parentNode.removeChild(header);
            if (footer && footer.parentNode)
                footer.parentNode.removeChild(footer);
        }
        let last_page_element: Node | null = container.lastChild;
        let pages: Page[] = [];
        // cuts are applied in reverse order as a trick to support (move_height > content_height) cuts
        for (let { page, num_pages, closest, outer, stack, header, footer } of cuts.reverse()) {
            // move nodes after outer into the page
            let { container, insert_before } = create_page(page, num_pages.num_pages, header, footer);
            while (last_page_element && last_page_element !== outer.node) {
                let p = last_page_element.previousSibling;
                container.insertBefore(last_page_element, insert_before);
                insert_before = last_page_element;
                last_page_element = p;
            }
            if (outer === closest) {
                last_page_element = outer.node.previousSibling;
            }
            // copy structure
            let parent: Element = container;
            for (let [i, cut] of stack.entries()) {
                let new_parent = parent;
                let after = (cut !== outer) ? cut.node.nextSibling : null;
                if (cut !== closest) {
                    let cut_node = cut.node as HTMLElement;
                    let empty_el = copy_element_empty(cut_node);
                    if (first_page_element_no_margin_top(empty_el.tagName))
                        empty_el.style.marginTop = "0px";
                    let thead = table_thead(cut_node);
                    if (thead)
                        empty_el.appendChild(clone_element(thead, []));
                    if (cut_node.tagName === "OL") {
                        let next_cut = stack[i + 1];
                        let li: Node | null = cut_node.firstChild;
                        let stop_li = next_cut.node.nextSibling;
                        let start = (cut_node as HTMLOListElement).start;
                        console.info(li, stop_li);
                        while (li && li !== stop_li) {
                            if (li.nodeName === "LI")
                                start++;
                            li = li.nextSibling;
                        }
                        (empty_el as HTMLOListElement).start = start;
                    }
                    new_parent.insertBefore(empty_el, insert_before);
                    parent = empty_el;
                    insert_before = null;
                }
                else {
                    new_parent.insertBefore(cut.node, insert_before);
                    let cut_el = next_element_sibling(cut.node);
                    if (cut_el && first_page_element_no_margin_top(cut_el.tagName))
                        cut_el.style.marginTop = "0px";
                }
                // move elements after cut_at -> after empty_el
                while (after) {
                    let next = after.nextSibling;
                    new_parent.appendChild(after);
                    after = next;
                }
            }
        }
        // first page
        {
            // move nodes after outer into the page
            let { container, insert_before } = create_page(first.page, first.num_pages.num_pages, first.header, first.footer);
            while (last_page_element) {
                let p = last_page_element.previousSibling;
                container.insertBefore(last_page_element, insert_before);
                insert_before = last_page_element;
                last_page_element = p;
            }
        }
        cuts.reverse()
        return pages.reverse();

        function create_page(page: number, num_pages: number, header: HTMLElement | null, footer: HTMLElement | null) {
            let page_num_str = `${page}`;

            let container = document.createElement("DIV");
            container.className = "page";
            container.setAttribute("page", page_num_str);
            container.setAttribute("paper", paper_str);
            container.setAttribute("paper-orientation", paper_orientation);

            let variables = [
                { rx: /{{\s*page\s*}}/, by: page_num_str },
                { rx: /{{\s*num_pages\s*}}/, by: `${num_pages}` },
            ];
            header = clone_element(header, variables);
            footer = clone_element(footer, variables);
            if (header) {
                header.setAttribute("page", page_num_str);
                container.appendChild(header);
            }
            if (footer) {
                footer.setAttribute("page", page_num_str);
                container.appendChild(footer);
            }

            pages.push({
                page,
                paper: {
                    format: paper,
                    margin: paper_margin,
                    orientation: paper_orientation,
                },
                container,
                header,
                footer,
            })

            let insert_before: Node | null = footer;
            return { container, insert_before };
        }
    }
    ///////////////
    // ALGO
    {
        performance.mark("paginate_start");

        let containers = create_containers();
        containers.forEach(({ container }) => body.appendChild(container));

        performance.mark("paginate_body_layout");

        let cut_counter = 0;
        for (let { container, paper_size, paper_margin, paper_orientation, first, cuts } of containers) {
            const margin_top = length_to_px(typeof paper_margin === "object" ? paper_margin.top : paper_margin);
            const margin_bottom = length_to_px(typeof paper_margin === "object" ? paper_margin.bottom : paper_margin);
            const page_height = length_to_px(paper_orientation === "portrait" ? paper_size.height : paper_size.width);
            const content_height = page_height - margin_top - margin_bottom;
            if (DEBUG) {
                console.info(`page_height = ${page_height}px ${page_height/unit.mm}mm`);
                console.info(`margin_top = ${margin_top}px ${margin_top/unit.mm}mm`);
                console.info(`margin_bottom = ${margin_bottom}px ${margin_bottom/unit.mm}mm`);
                console.info(`content_height = ${content_height}px ${content_height/unit.mm}mm`);
            }

            let top = container.getBoundingClientRect().top;

            expected_page_bottom = top + content_height + margin_top;
            let stack = next_cut_stack(container.firstElementChild);
            while (stack.length) {
                let outer = stack[0];
                let closest = stack[stack.length - 1];
                let original_closest = { ...closest };

                // find the real closest node with consideration of inline nodes (span, b, #text)
                // this assume white-space: normal to work correctly
                while (closest !== outer) {
                    closest = stack[stack.length - 1] = fix_weird_cut_positions(closest, expected_page_bottom);
                    let previous = closest.node.previousSibling;
                    if (previous instanceof Text && is_text_content_whitespace(previous)) {
                        closest.node = previous;
                        closest.tagName = "#spaces";
                        previous = closest.node.previousSibling;
                    }
                    if (previous) {
                        if (closest.top > expected_page_bottom) {
                            let previous_cutable_block = previous_element_sibling(previous);
                            while (previous_cutable_block && !cut_tag_names.has(previous_cutable_block.tagName))
                                previous_cutable_block = previous_element_sibling(previous_cutable_block.previousSibling);
                            let real_closest_node = previous_cutable_block ? previous_cutable_block.nextSibling : null;
                            if (real_closest_node) {
                                if (real_closest_node !== closest.node) {
                                    closest.node = real_closest_node;
                                    closest.tagName = "#text";
                                    let bottom = previous_cutable_block!.getBoundingClientRect().bottom;
                                    bottom += parseFloat(window.getComputedStyle(previous_cutable_block!).marginBottom!);
                                    closest.top = closest.bottom = bottom;
                                }

                                break;
                            }
                        }
                        else {
                            break;
                        }
                    }

                    stack.pop();
                    closest = stack[stack.length - 1];
                }
                if (closest === outer) {
                    closest = outer = stack[0] = fix_weird_cut_positions(closest, expected_page_bottom);
                }

                // page count
                if (cuts.length === 0) {
                    page++;
                    num_pages.num_pages++;
                    Object.assign(first, { page, num_pages, header, footer });
                }
                page++;
                num_pages.num_pages++;

                // compute structure top/bottom height
                let parents_top_height = structure_top_height(stack, outer, closest);
                let next_expected_page_bottom = closest.top + content_height - parents_top_height; // - parents_bottom_height;
                if (DEBUG) console.info(`idx=${cut_counter} page=${page}
${Math.round(expected_page_bottom)} -> ${Math.round(next_expected_page_bottom)} = ${Math.round(closest.top)} + ${Math.round(content_height)} - ${Math.round(parents_top_height)}
expected_overcut: ${Math.round(expected_page_bottom - closest.top)}
original_closest:`, original_closest, `
original_closest-1:`, cut_from_element(previous_element_sibling(original_closest.node.previousSibling)), `
stack:
`, ...([] as any[]).concat(...stack.map(s => [s, "\n"])));
                let cut_page: CutPage = {
                    original_closest,
                    closest,
                    outer,
                    stack,
                    parents_top_height,
                    page,
                    num_pages,
                    header,
                    footer,
                    top,
                    expected_page_bottom,
                    next_expected_page_bottom,
                };
                cuts.push(cut_page);
                cut_counter++;
                if (next_expected_page_bottom <= expected_page_bottom) {
                    console.error(`stopping page cut calculation, infinite loop detected`);
                    console.error(` next_expected_page_bottom:${next_expected_page_bottom} < expected_page_bottom:${expected_page_bottom}`);
                    console.error(` current page_cut`, cut_page);
                    throw new Error(`infinite loop detected`);
                }
                expected_page_bottom = next_expected_page_bottom;
                stack = next_cut_stack(outer.node);
            }
        }

        performance.mark("paginate_compute_cuts");

        if (DEBUG) console.info(containers);

        let ret: Page[] = [];
        let css = `@page { margin: 0cm; }`;
        for (let c of containers) {
            if (!PAGINATE) {
                for (let { closest } of c.cuts) {
                    next_element_sibling(closest.node)!.className = "__willcut";
                }
                for (let { top, expected_page_bottom } of c.cuts) {
                    let cut = document.createElement('div');
                    cut.className = "__expected_cut";
                    cut.style.top = `${expected_page_bottom - top}px`;
                    c.container.appendChild(cut);
                }
            }
            else {
                let pages: Page[] = create_pages(c);
                css += `
.page[paper=${c.paper_str}][paper-orientation=${c.paper_orientation}] {
	box-sizing: border-box;
    overflow: hidden;
    width: ${c.paper_orientation === "portrait" ? c.paper_size.width : c.paper_size.height};
    /* calc(length - 1px) workaround one page beeing printed as two (the second one beeing empty) */
    height: calc(${c.paper_orientation === "portrait" ? c.paper_size.height : c.paper_size.width} - 1px);
    padding-top: ${c.paper_margin.top};
    padding-right: ${c.paper_margin.right};
    padding-bottom: ${c.paper_margin.bottom};
    padding-left: ${c.paper_margin.left};
    page-break-after: always;
    page-break-inside: avoid;
}`;
                // commit pages
                pages.forEach(page => body.appendChild(page.container));
                body.className += " pages";
                body.removeChild(c.container);

                ret.push(...pages);
            }
        }
        let style = document.createElement("style");
        style.type = "text/css";
        style.textContent = css;
        document.head!.appendChild(style);

        performance.mark("paginate_end");

        performance.measure("paginate", "paginate_start", "paginate_end");
        performance.measure("paginate_body-layout", "paginate_start", "paginate_body_layout");
        performance.measure("paginate_compute-cuts", "paginate_body_layout", "paginate_compute_cuts");
        performance.measure("paginate_apply-cuts", "paginate_compute_cuts", "paginate_end");

        return ret;
    }

}
