import { buildBusinessReadiness } from "../lib/businessReadiness";

export default function BusinessSetupCenter({
  catalog,
  draftState,
  currentUserRole = "admin",
  providerConnected = false,
  onOpenSection
}) {
  const model = buildBusinessReadiness({ catalog, draftState, currentUserRole, providerConnected });
  const readiness = Object.values(model.projections);

  return (
    <section className="business-setup-center" data-capability-id="business-setup-readiness" aria-labelledby="business-setup-title">
      <header className="business-setup-center__header">
        <div>
          <p className="ambient-library__label">Business Setup Center</p>
          <h2 id="business-setup-title">Know what is ready before the next quote.</h2>
        </div>
        <strong className={model.businessReady ? "is-ready" : "needs-review"}>
          {model.businessReady ? "Ready to quote" : "Setup needs review"}
        </strong>
      </header>

      <div className="business-setup-center__signals" aria-label="Independent readiness checks">
        {readiness.map((item) => (
          <article key={item.id} data-readiness-id={item.id} data-readiness-ready={item.ready ? "true" : "false"}>
            <span>{item.ready ? "Ready" : item.blocking ? "Blocked" : "Not ready"}</span>
            <strong>{item.label}</strong>
            <small>{item.reasonCode.replaceAll("_", " ")}</small>
          </article>
        ))}
      </div>

      <ol className="business-setup-center__checklist">
        {model.rows.map((row, index) => (
          <li key={row.id}>
            <span className="business-setup-center__index">{String(index + 1).padStart(2, "0")}</span>
            <div><strong>{row.label}</strong>{row.detail && <small>{row.detail}</small>}</div>
            <span className={`business-setup-center__status status-${row.status.toLowerCase().replaceAll(" ", "-")}`}>{row.status}</span>
            <button type="button" className="ghost" onClick={() => onOpenSection?.(row.target)} disabled={!model.isAdmin}>
              {row.nextAction}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
