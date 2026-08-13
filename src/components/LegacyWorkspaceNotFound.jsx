export default function WorkspaceNotFound({ pathname = "", onHome }) {
  return (
    <main className="container workspace-route-main">
      <section className="panel workspace-not-found" aria-labelledby="workspace-not-found-title">
        <p className="eyebrow">404</p>
        <h1 id="workspace-not-found-title">Workspace page not found</h1>
        <p className="muted">{pathname || "This path"} is not a QuotePilot staff workspace route.</p>
        <button type="button" className="cta" onClick={onHome}>Return home</button>
      </section>
    </main>
  );
}
