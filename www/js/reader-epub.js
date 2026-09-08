/* Liber.EpubReader — thin wrapper around epub.js */
(function () {
  let book = null;
  let rendition = null;
  let currentBookId = null;

  async function open(bookRecord) {
    currentBookId = bookRecord.id;
    const container = document.getElementById("epub-viewer");
    container.innerHTML = "";
    document.getElementById("pdf-viewer").hidden = true;
    container.hidden = false;

    book = ePub(bookRecord.data);
    rendition = book.renderTo(container, {
      width: "100%",
      height: "100%",
      flow: "scrolled",
      manager: "continuous",
    });

    rendition.themes.default({
      body: {
        background: "#000000 !important",
        color: "#ffffff !important",
      },
      "a, a:link": { color: "#ffffff !important" },
    });

    const startCfi = bookRecord.progress && bookRecord.progress.cfi;
    await rendition.display(startCfi || undefined);

    rendition.on("relocated", (location) => {
      const cfi = location.start.cfi;
      let percent = 0;
      try {
        percent = book.locations.length()
          ? Math.round(book.locations.percentageFromCfi(cfi) * 100)
          : 0;
      } catch (e) {}
      LiberDB.updateBook(currentBookId, {
        progress: { cfi, percent },
        lastOpenedAt: Date.now(),
      });
      document.getElementById("reader-progress").textContent = percent
        ? percent + "%"
        : "";
    });

    // Build locations in the background for percentage tracking (best-effort).
    book.locations.generate(1000).catch(() => {});

    await buildToc();
    return true;
  }

  async function buildToc() {
    const list = document.getElementById("toc-list");
    list.innerHTML = "";
    const nav = await book.loaded.navigation;
    (nav.toc || []).forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item.label.trim();
      li.addEventListener("click", () => {
        rendition.display(item.href);
        document.getElementById("toc-panel").hidden = true;
      });
      list.appendChild(li);
    });
  }

  function next() {
    if (rendition) rendition.next();
  }
  function prev() {
    if (rendition) rendition.prev();
  }

  function destroy() {
    if (rendition) {
      rendition.destroy();
      rendition = null;
    }
    book = null;
    currentBookId = null;
  }

  window.LiberEpubReader = { open, next, prev, destroy };
})();
