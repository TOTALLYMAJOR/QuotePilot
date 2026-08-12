export function buildWorkspaceUnavailablePresentation({
  pathname = "",
  reason = "",
  routeId = "",
  ambientMode = false
} = {}) {
  if (ambientMode && reason === "role-denied" && routeId === "catalog") {
    return {
      eyebrow: "Library access",
      title: "Library requires organization admin access",
      description: "Catalog and template settings can change pricing and the starting details used in new quotes. Your current role cannot open or change them.",
      actionLabel: "Return to Now"
    };
  }

  return {
    eyebrow: "404",
    title: "Workspace page not found",
    description: `${pathname || "This path"} is not a QuotePilot staff workspace route.`,
    actionLabel: "Return home"
  };
}

export default function WorkspaceNotFound({
  pathname = "",
  reason = "",
  routeId = "",
  ambientMode = false,
  onHome
}) {
  const presentation = buildWorkspaceUnavailablePresentation({
    pathname,
    reason,
    routeId,
    ambientMode
  });

  return (
    <main className="container workspace-route-main">
      <section className="panel workspace-not-found" aria-labelledby="workspace-not-found-title">
        <p className="eyebrow">{presentation.eyebrow}</p>
        <h1 id="workspace-not-found-title">{presentation.title}</h1>
        <p className="muted">{presentation.description}</p>
        <button type="button" className="cta" onClick={onHome}>{presentation.actionLabel}</button>
      </section>
    </main>
  );
}
