import { buildBusinessReadiness } from "../lib/businessReadiness";
import {
  Broadcast,
  CurrencyDollar,
  FileText,
  ListChecks,
  Package,
  UserGear,
  UsersThree,
  Wallet,
  WarningCircle
} from "./ProductIcons";

const READINESS_ICONS = Object.freeze({
  publishing: WarningCircle,
  identity: UserGear,
  offerings: Package,
  pricing: CurrencyDollar,
  costs: Wallet,
  "starting-points": FileText,
  staffing: UsersThree,
  users: UserGear,
  connections: Broadcast
});

const ROW_PRESENTATION = Object.freeze({
  identity: {
    detail: "Business name and proposal identity",
    action: "Update business identity"
  },
  offerings: {
    detail: "A sellable offer, event type, and menu",
    action: "Open offers and menus"
  },
  pricing: {
    detail: "Rates and selling policy",
    action: "Configure pricing"
  },
  costs: {
    detail: "Costs needed for complete margin evidence",
    action: "Record missing costs"
  },
  "starting-points": {
    detail: "Reusable starting points for common events",
    action: "Manage templates"
  },
  staffing: {
    detail: "Labor and service policy",
    action: "Configure staffing"
  },
  users: {
    detail: "Workspace access and roles",
    action: "Manage users"
  },
  connections: {
    detail: "Services used to complete customer work",
    action: "Open workspace tools"
  }
});

function issueStatus(row) {
  if (row.status === "Connection required") return "Required";
  return row.status === "Needs review" ? "Needs attention" : row.status;
}

function ReadinessIcon({ id, ready = false }) {
  const Icon = READINESS_ICONS[id] || ListChecks;
  return (
    <span
      className="business-setup-center__row-icon"
      data-readiness-icon={id}
      data-state={ready ? "ready" : "attention"}
      aria-hidden="true"
    >
      <Icon size={18} weight={ready ? "regular" : "bold"} />
    </span>
  );
}

function buildReadinessPresentation(model) {
  const rows = model.rows.map((row) => ({
    ...row,
    detail: row.detail || ROW_PRESENTATION[row.id]?.detail || "Setup needs attention",
    actionLabel: ROW_PRESENTATION[row.id]?.action || "Continue setup"
  }));
  const unresolved = rows.filter((row) => !["Ready", "Unavailable by policy"].includes(row.status));
  const ready = rows.filter((row) => row.status === "Ready");
  const publicationUnavailable = model.projections.businessReadyToQuote.reasonCode === "authoritative_catalog_unavailable";

  if (publicationUnavailable) {
    unresolved.unshift({
      id: "publishing",
      label: "Published Library",
      status: "Publishing unavailable",
      detail: "Your currently published settings remain active.",
      actionLabel: "Check again",
      actionKind: "refresh"
    });
  }

  return {
    ready,
    unresolved,
    complete: unresolved.length === 0,
    primary: unresolved[0] || null
  };
}

export default function BusinessSetupCenter({
  catalog,
  draftState,
  currentUserRole = "admin",
  providerConnected = false,
  onOpenSection,
  onRefresh
}) {
  const model = buildBusinessReadiness({ catalog, draftState, currentUserRole, providerConnected });
  const presentation = buildReadinessPresentation(model);
  const count = presentation.unresolved.length;
  const headline = presentation.complete
    ? "Ready for quoting."
    : `${count} setup ${count === 1 ? "area needs" : "areas need"} attention.`;

  const runPrimaryAction = (event) => {
    if (!model.isAdmin || !presentation.primary) return;
    if (presentation.primary.actionKind === "refresh") {
      onRefresh?.(event.currentTarget);
      return;
    }
    onOpenSection?.(presentation.primary.target, event.currentTarget);
  };

  return (
    <section
      className={`business-setup-center${presentation.complete ? " is-complete" : " has-attention"}`}
      data-capability-id="business-setup-readiness"
      data-readiness-state={presentation.complete ? "ready" : "attention"}
      aria-labelledby="business-setup-title"
    >
      <header className="business-setup-center__header">
        <p className="ambient-library__label">
          {presentation.complete ? "Business setup" : "Before the next quote"}
        </p>
        <h2 id="business-setup-title">{headline}</h2>
        <p>
          {presentation.complete
            ? "Offers, starting points, and selling policy are ready to use."
            : "Start with the first unresolved area; completed setup stays out of the way."}
        </p>
        {model.isAdmin && presentation.primary && (
          <button type="button" className="business-setup-center__primary" onClick={runPrimaryAction}>
            {presentation.primary.actionLabel}<span aria-hidden="true">→</span>
          </button>
        )}
        {!model.isAdmin && (
          <p className="business-setup-center__readonly" data-library-readonly>
            You can inspect this Library. An administrator manages changes and publishing.
          </p>
        )}
      </header>

      {!presentation.complete && (
        <ol className="business-setup-center__attention" aria-label="Setup areas needing attention">
          {presentation.unresolved.map((row) => (
            <li key={row.id} data-readiness-id={row.id} data-readiness-ready="false">
              <ReadinessIcon id={row.id} />
              <div>
                <strong>{row.label}</strong>
                <small>{row.detail}</small>
              </div>
              <span className="business-setup-center__attention-status">{issueStatus(row)}</span>
            </li>
          ))}
        </ol>
      )}

      {presentation.ready.length > 0 && (
        <details className="business-setup-center__ready">
          <summary>{presentation.ready.length} setup {presentation.ready.length === 1 ? "area" : "areas"} ready</summary>
          <ul>
            {presentation.ready.map((row) => (
              <li key={row.id} data-readiness-id={row.id} data-readiness-ready="true">
                <ReadinessIcon id={row.id} ready />
                <span>{row.label}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
