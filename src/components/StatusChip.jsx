import { STATUS_FAMILY } from "../lib/statusSemantics";

const FAMILY_CLASS = {
  [STATUS_FAMILY.INFO]: "status-chip-info",
  [STATUS_FAMILY.PENDING]: "status-chip-pending",
  [STATUS_FAMILY.ACTION]: "status-chip-action",
  [STATUS_FAMILY.CUSTOMER_ACTION]: "status-chip-customer",
  [STATUS_FAMILY.PROVIDER]: "status-chip-provider",
  [STATUS_FAMILY.CONFIRMED]: "status-chip-confirmed",
  [STATUS_FAMILY.BLOCKED]: "status-chip-blocked",
  [STATUS_FAMILY.FAILED]: "status-chip-failed",
  [STATUS_FAMILY.EXPIRED]: "status-chip-expired",
  [STATUS_FAMILY.ARCHIVED]: "status-chip-archived"
};

export default function StatusChip({ family, label, className = "" }) {
  const familyClass = FAMILY_CLASS[family] || FAMILY_CLASS[STATUS_FAMILY.INFO];
  return (
    <span className={`status-chip ${familyClass} ${className}`.trim()}>
      <span className="status-chip-dot" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
