// Shared by portal and in-tree modals. Only the top connected modal owns
// background isolation. Restore exact pre-existing attributes on release.
const documents = new WeakMap();
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "LINK"]);

function backgroundNodes(root, documentObject) {
  const result = new Set();
  let branch = root;
  while (branch && branch !== documentObject.body) {
    const parent = branch.parentElement;
    if (!parent) break;
    for (const sibling of parent.children) {
      if (sibling !== branch && !SKIP_TAGS.has(sibling.tagName)) result.add(sibling);
    }
    branch = parent;
  }
  return result;
}

function restore(node, snapshot) {
  if (snapshot.inertProperty !== undefined) node.inert = snapshot.inertProperty;
  if (snapshot.hadInert) node.setAttribute("inert", snapshot.inert ?? "");
  else node.removeAttribute("inert");
  if (snapshot.hadAriaHidden) node.setAttribute("aria-hidden", snapshot.ariaHidden ?? "");
  else node.removeAttribute("aria-hidden");
}

function reconcile(documentObject, state) {
  const active = state.scopes.findLast((scope) => (
    scope.root.isConnected && documentObject.body.contains(scope.root)
  ));
  const desired = active ? backgroundNodes(active.root, documentObject) : new Set();
  for (const [node, snapshot] of state.snapshots) {
    if (!desired.has(node)) {
      restore(node, snapshot);
      state.snapshots.delete(node);
    }
  }
  for (const node of desired) {
    if (state.snapshots.has(node)) continue;
    state.snapshots.set(node, {
      hadAriaHidden: node.hasAttribute("aria-hidden"),
      ariaHidden: node.getAttribute("aria-hidden"),
      hadInert: node.hasAttribute("inert"),
      inert: node.getAttribute("inert"),
      inertProperty: "inert" in node ? node.inert : undefined
    });
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("inert", "");
    if ("inert" in node) node.inert = true;
  }
}

export function isolateModalBackground(root) {
  const documentObject = root?.ownerDocument;
  if (!root?.isConnected || !documentObject?.body?.contains(root)) return () => {};
  let state = documents.get(documentObject);
  if (!state) {
    state = { scopes: [], snapshots: new Map(), observer: null };
    documents.set(documentObject, state);
    const Observer = documentObject.defaultView?.MutationObserver;
    if (Observer) {
      state.observer = new Observer(() => reconcile(documentObject, state));
      // Attributes are deliberately not observed: our own isolation must not
      // trigger an observer loop. Late DOM siblings must still be isolated.
      state.observer.observe(documentObject.body, { childList: true, subtree: true });
    }
  }
  const scope = { root };
  state.scopes.push(scope);
  reconcile(documentObject, state);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = state.scopes.indexOf(scope);
    if (index >= 0) state.scopes.splice(index, 1);
    reconcile(documentObject, state);
    if (!state.scopes.length) {
      state.observer?.disconnect();
      documents.delete(documentObject);
    }
  };
}
