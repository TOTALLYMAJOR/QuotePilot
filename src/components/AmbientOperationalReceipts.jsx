import {
  CheckCircle,
  ClockCountdown,
  Prohibit,
  WarningCircle
} from "@phosphor-icons/react";
import "./ambientOperationalReceipts.css";

const ICONS = {
  resolved: CheckCircle,
  not_due: ClockCountdown,
  needs_action: WarningCircle,
  needs_evidence: WarningCircle,
  partial: WarningCircle,
  unavailable: Prohibit
};

function ReceiptRow({ receipt }) {
  const Icon = ICONS[receipt.state] || WarningCircle;
  return (
    <li data-operational-receipt={receipt.id} data-receipt-state={receipt.state}>
      <Icon size={19} weight={receipt.state === "resolved" ? "fill" : "regular"} aria-hidden="true" />
      <div>
        <span>{receipt.label}</span>
        <strong>{receipt.summary}</strong>
        <p>{receipt.detail}</p>
        <small>
          Source: {receipt.source}. {receipt.receiptId ? `Receipt ${receipt.receiptId}.` : "No exact receipt exposed."}
        </small>
      </div>
    </li>
  );
}

export default function AmbientOperationalReceipts({ model }) {
  if (!model?.surfaceContract || !model.applicable) return null;
  return (
    <section
      className="ambient-operational-receipts"
      aria-labelledby="ambient-operational-receipts-title"
      data-surface-contract-id={model.surfaceContract.id}
      data-surface-purpose={model.surfaceContract.purposes.join(" ")}
      data-operational-lifecycle={model.lifecycleState}
    >
      <header>
        <div>
          <p className="ambient-kicker">Recorded outcomes</p>
          <h2 id="ambient-operational-receipts-title">What is settled, and what is not</h2>
          <p>{model.summary}</p>
        </div>
        <aside data-next-operational-state={model.nextUnresolved.state}>
          <span>Next operational resolution</span>
          <strong>{model.nextUnresolved.label}</strong>
          <small>{model.nextUnresolved.consequence}</small>
        </aside>
      </header>
      <ul>
        {model.receipts.map((receipt) => <ReceiptRow key={receipt.id} receipt={receipt} />)}
      </ul>
    </section>
  );
}
