export async function readCompletePages({ pageSize = 200, readPage } = {}) {
  const boundedPageSize = Number(pageSize);
  if (!Number.isInteger(boundedPageSize) || boundedPageSize < 1 || boundedPageSize > 500) {
    throw new Error("pageSize must be an integer between 1 and 500.");
  }
  if (typeof readPage !== "function") throw new Error("readPage is required.");

  const items = [];
  let afterId = "";
  let pageCount = 0;
  while (true) {
    const pageNumber = pageCount + 1;
    const page = await readPage({ afterId, pageSize: boundedPageSize, pageNumber });
    if (!Array.isArray(page)) throw new Error(`Page ${pageNumber} did not return an array.`);
    if (!page.length) break;
    if (page.length > boundedPageSize) throw new Error(`Page ${pageNumber} exceeded its declared bound.`);

    let previousId = afterId;
    page.forEach((item) => {
      const id = String(item?.id || "").trim();
      if (!id) throw new Error(`Page ${pageNumber} returned an item without a stable document ID.`);
      if (id === previousId || (previousId && id < previousId)) {
        throw new Error(`Page ${pageNumber} cursor did not advance in stable document ID order.`);
      }
      previousId = id;
    });

    items.push(...page);
    pageCount += 1;
    const nextAfterId = String(page[page.length - 1].id).trim();
    if (nextAfterId === afterId) throw new Error(`Page ${pageNumber} cursor did not advance.`);
    afterId = nextAfterId;
    if (page.length < boundedPageSize) break;
  }

  return {
    items,
    complete: true,
    pageCount,
    pageSize: boundedPageSize,
    recordCount: items.length,
    lastId: afterId
  };
}
