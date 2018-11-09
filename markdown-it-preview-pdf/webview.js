// remove_base_css
for (let link of document.querySelectorAll("head > link[rel=stylesheet]")) {
    if (link.href && link.href.indexOf("/markdown-language-features/") !== -1) {
        link.parentNode.removeChild(link);
    }
}

window.addEventListener('load', () => paginate());
