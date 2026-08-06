import {
  PRODUCT_COMPANY,
  PRODUCT_FULL_NAME,
  PRODUCT_MARK_URL,
  PRODUCT_NAME
} from "../lib/productIdentity";

export default function ProductBrandLockup({ className = "", compact = false }) {
  const classes = [
    "product-brand-lockup",
    compact ? "product-brand-lockup-compact" : "",
    className
  ].filter(Boolean).join(" ");

  return (
    <span className={classes} aria-label={PRODUCT_FULL_NAME}>
      <img src={PRODUCT_MARK_URL} alt="" width={compact ? 40 : 48} height={compact ? 40 : 48} />
      <span className="product-brand-copy">
        <strong>{PRODUCT_NAME}</strong>
        <small>by {PRODUCT_COMPANY}</small>
      </span>
    </span>
  );
}
