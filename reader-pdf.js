/* Liber.PdfReader — continuous-scroll wrapper around pdf.js.
 * pdfjs-dist ships as an ES module, so it's loaded via a dynamic import in
 * index.html which resolves window.LiberPdfjsReady; we await that before
 * touching pdfjsLib anywhere in here. */
(function () {
  let pdfDoc = null;
  let currentBookId = null;
  let container = null;
  let pageWrappers = []; // { pageNum, el, rendered }
  let observer = null;
  let scale = 1;
  let saveTimer = null;
  let restoring = false;

  function ensurePdfjs() {
    return window.LiberPdfjsReady || Promise.resolve();
  }

  async function open(bookRecord) {
    currentBookId = bookRecord.id;
    document.getElementById("epub-viewer").hidden = true;
    container = document.getElementById("pdf-viewer");
    container.hidden = false;
    container.innerHTML = "";
    pageWrappers = [];

    await ensurePdfjs();
    if (!window.pdfjsLib) {
      container.innerHTML = '<p style="color:#a8a8a8;padding:24px;">Couldn\'t load the PDF engine. Try reopening the book.</p>';
      return false;
    }

    const data = await bookRecord.data.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data }).promise;

    const firstPage = await pdfDoc.getPage(1);
    const baseViewport = firstPage.getViewport({ scale: 1 });
    const targetWidth = container.clientWidth || 360;
    scale = targetWidth / baseViewport.width;
    const estHeight = baseViewport.height * scale;

    // Placeholder for every page up front, so the scroll height (and the
    // scrollbar) is correct immediately. Pages render lazily as they near
    // the viewport, via IntersectionObserver, below.
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= pdfDoc.numPages; n++) {
      const wrapper = document.createElement("div");
      wrapper.className = "pdf-page";
      wrapper.dataset.page = String(n);
      wrapper.style.height = estHeight + "px";
      frag.appendChild(wrapper);
      pageWrappers.push({ pageNum: n, el: wrapper, rendered: false });
    }
    container.appendChild(frag);

    setupObserver();
    pageWrappers.forEach((w) => observer.observe(w.el));
    container.addEventListener("scroll", onScroll);

    const savedPage = (bookRecord.progress && bookRecord.progress.page) || 1;
    if (savedPage > 1) {
      restoring = true;
      requestAnimationFrame(() => {
        const target = pageWrappers[savedPage - 1];
        if (target) container.scrollTop = target.el.offsetTop;
        restoring = false;
      });
    }

    buildToc();
    return true;
  }

  function setupObserver() {
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const w = pageWrappers.find((p) => p.el === entry.target);
          if (w && !w.rendered) renderPage(w);
        });
      },
      { root: container, rootMargin: "1000px 0px 1000px 0px" }
    );
  }

  async function renderPage(wrapper) {
    wrapper.rendered = true; // set early so we don't queue it twice
    const page = await pdfDoc.getPage(wrapper.pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    wrapper.el.style.height = viewport.height + "px";
    wrapper.el.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    try {
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (e) {
      /* page may have been cancelled by a fast scroll; harmless */
    }
  }

  function currentVisiblePage() {
    if (!container || !pageWrappers.length) return null;
    const probe = container.scrollTop + container.clientHeight * 0.3;
    for (const w of pageWrappers) {
      if (w.el.offsetTop <= probe && w.el.offsetTop + w.el.offsetHeight > probe) {
        return w.pageNum;
      }
    }
    return pageWrappers[pageWrappers.length - 1].pageNum;
  }

  function onScroll() {
    if (restoring) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const current = currentVisiblePage();
      if (!current || !pdfDoc) return;
      const percent = Math.round((current / pdfDoc.numPages) * 100);
      document.getElementById("reader-progress").textContent =
        current + " / " + pdfDoc.numPages;
      LiberDB.updateBook(currentBookId, {
        progress: { page: current, percent },
        lastOpenedAt: Date.now(),
      });
    }, 250);
  }

  async function buildToc() {
    const list = document.getElementById("toc-list");
    list.innerHTML = "";
    try {
      const outline = await pdfDoc.getOutline();
      (outline || []).forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item.title;
        li.addEventListener("click", async () => {
          if (Array.isArray(item.dest)) {
            const idx = await pdfDoc.getPageIndex(item.dest[0]);
            scrollToPage(idx + 1);
          }
          document.getElementById("toc-panel").hidden = true;
        });
        list.appendChild(li);
      });
    } catch (e) {
      /* some PDFs have no outline */
    }
  }

  function scrollToPage(num, smooth) {
    const target = pageWrappers[num - 1];
    if (!target || !container) return;
    container.scrollTo({
      top: target.el.offsetTop,
      behavior: smooth ? "smooth" : "auto",
    });
  }

  function next() {
    const current = currentVisiblePage() || 1;
    if (pdfDoc && current < pdfDoc.numPages) scrollToPage(current + 1, true);
  }
  function prev() {
    const current = currentVisiblePage() || 1;
    if (current > 1) scrollToPage(current - 1, true);
  }

  function destroy() {
    if (observer) observer.disconnect();
    if (container) container.removeEventListener("scroll", onScroll);
    observer = null;
    pdfDoc = null;
    pageWrappers = [];
    container = null;
    currentBookId = null;
  }

  window.LiberPdfReader = { open, next, prev, destroy };
})();
