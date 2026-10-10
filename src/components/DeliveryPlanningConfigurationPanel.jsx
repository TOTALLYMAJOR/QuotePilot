import { useEffect, useMemo, useRef, useState } from "react";
import {
  assessDeliveryPlanningConfiguration,
  buildDeliveryPlanningDraftCatalog,
  normalizeDeliverySourceReference,
  parseDeliveryPlanningSourceDrafts
} from "../lib/deliveryPlanningConfiguration";
import AdaptiveChoiceField from "./AdaptiveChoiceField";
import FieldStateIndicator from "./FieldStateIndicator";

function text(value) {
  return String(value ?? "").trim();
}

function blueprintKey(value) {
  const reference = normalizeDeliverySourceReference(value);
  return reference.id && reference.revision ? `${reference.id}@${reference.revision}` : "";
}

function splitBlueprintKey(value) {
  const [id = "", revision = ""] = text(value).split("@");
  return { id, revision };
}

export default function DeliveryPlanningConfigurationPanel({
  catalog = {},
  jsonDrafts = {},
  onPatchJson,
  onPatchSetting,
  onPatchPackageField,
  onReviewOffers
}) {
  const sourceDetailsRef = useRef(null);
  const parsed = useMemo(() => parseDeliveryPlanningSourceDrafts(jsonDrafts), [jsonDrafts]);
  const draftCatalog = useMemo(() => (
    parsed.ok ? buildDeliveryPlanningDraftCatalog(catalog, jsonDrafts) : catalog
  ), [catalog, jsonDrafts, parsed.ok]);
  const assessment = useMemo(
    () => assessDeliveryPlanningConfiguration(draftCatalog),
    [draftCatalog]
  );
  const activeOffers = useMemo(() => (
    (Array.isArray(catalog?.packages) ? catalog.packages : [])
      .filter((offer) => offer?.active !== false)
      .map((offer) => ({ value: text(offer.id), label: text(offer.name) || text(offer.id) }))
  ), [catalog?.packages]);
  const blueprintOptions = assessment.eligibleBlueprints.map((blueprint) => ({
    value: `${blueprint.id}@${blueprint.revision}`,
    label: `${blueprint.label} · revision ${blueprint.revision}`
  }));
  const initiallyBoundOffer = (catalog?.packages || []).find((offer) => blueprintKey(offer?.deliveryBlueprintRef));
  const [selectedOfferId, setSelectedOfferId] = useState(
    () => text(initiallyBoundOffer?.id || activeOffers[0]?.value)
  );
  const selectedOffer = (catalog?.packages || []).find((offer) => text(offer?.id) === selectedOfferId) || null;
  const currentBlueprintKey = blueprintKey(selectedOffer?.deliveryBlueprintRef);
  const [selectedBlueprintKey, setSelectedBlueprintKey] = useState(
    () => currentBlueprintKey || blueprintOptions[0]?.value || ""
  );

  useEffect(() => {
    if (activeOffers.some((offer) => offer.value === selectedOfferId)) return;
    setSelectedOfferId(activeOffers[0]?.value || "");
  }, [activeOffers, selectedOfferId]);

  useEffect(() => {
    if (blueprintOptions.some((blueprint) => blueprint.value === selectedBlueprintKey)) return;
    setSelectedBlueprintKey(currentBlueprintKey || blueprintOptions[0]?.value || "");
  }, [blueprintOptions, currentBlueprintKey, selectedBlueprintKey]);

  const openSources = () => {
    if (sourceDetailsRef.current) sourceDetailsRef.current.open = true;
    sourceDetailsRef.current?.querySelector("textarea")?.focus?.({ preventScroll: true });
  };
  const visibleIssues = [...parsed.issues, ...assessment.issues];
  const activationState = assessment.canEnable
      ? { editability: "draft" }
      : { editability: "blocked" };
  const activationLabel = assessment.enabled && assessment.canEnable
    ? "Enabled in this draft"
    : assessment.canEnable
      ? "Ready to enable"
      : "Needs configuration";

  const bindBlueprint = () => {
    if (!selectedOfferId || !selectedBlueprintKey) return;
    onPatchPackageField?.(
      selectedOfferId,
      "deliveryBlueprintRef",
      splitBlueprintKey(selectedBlueprintKey)
    );
  };

  return (
    <section
      className="admin-section delivery-planning-configuration"
      data-testid="delivery-planning-configuration"
      data-field-state-surface="delivery-planning-configuration"
      data-capability-state={assessment.canEnable ? "draft" : "blocked"}
    >
      <div className="admin-section-head delivery-planning-configuration__head">
        <div className="delivery-planning-configuration__intro">
          <p className="eyebrow">Delivery planning</p>
          <h3>Turn an Offer into reviewable work</h3>
          <p className="source-note">
            Publish only operator-reviewed work blocks, production quantities, and purchasing packs. QuotePilot will not infer them from history or menu names.
          </p>
        </div>
        <FieldStateIndicator
          state={activationState}
          label="Delivery Planning activation"
          primaryState={assessment.canEnable ? "draft" : "blocked"}
          reason={visibleIssues[0]?.message || "The current published sources and Offer binding are exact."}
          provenance="Tenant Library draft"
          recoveryAction={!assessment.canEnable ? { label: "Review source", onClick: openSources } : undefined}
        />
      </div>

      <div className="delivery-planning-configuration__summary" aria-label="Delivery Planning activation summary">
        <div>
          <span>Activation</span>
          <strong>{activationLabel}</strong>
          <small>{assessment.enabled ? "Applies after this Library draft is saved and pricing is reconfirmed." : "No new quote receives a Delivery Proposal yet."}</small>
        </div>
        <div>
          <span>Blueprints</span>
          <strong>{assessment.counts.eligibleBlueprints}/{assessment.counts.publishedBlueprints} eligible</strong>
          <small>Exact published revisions only.</small>
        </div>
        <div>
          <span>Policies</span>
          <strong>{assessment.counts.publishedPolicies} published</strong>
          <small>Guest bounds and quantity math remain tenant declarations.</small>
        </div>
        <div>
          <span>Offer coverage</span>
          <strong>{assessment.counts.boundOffers}/{assessment.counts.activeOffers} bound</strong>
          <small>Unbound Offers keep Delivery Planning off.</small>
        </div>
      </div>

      <div className="admin-grid-settings">
        <AdaptiveChoiceField
          id="delivery-planning-offer"
          name="deliveryPlanningOffer"
          label="Offer"
          description="Choose the Offer that should use the reviewed Blueprint."
          options={activeOffers}
          value={selectedOfferId}
          onChange={(event) => setSelectedOfferId(event.target.value)}
          emptyReason="Add an active Offer before configuring Delivery Planning."
          recoveryAction={{ label: "Review Offers", onClick: onReviewOffers }}
          singleChoiceDetail="This is the only active Offer in the current Library draft."
        />
        <AdaptiveChoiceField
          id="delivery-planning-blueprint"
          name="deliveryPlanningBlueprint"
          label="Published Delivery Blueprint"
          description="Only exact revisions that pass the staffed-buffet activation checks appear here."
          options={blueprintOptions}
          value={selectedBlueprintKey}
          onChange={(event) => setSelectedBlueprintKey(event.target.value)}
          emptyReason="No published Blueprint currently passes the activation checks."
          recoveryAction={{ label: "Review source", onClick: openSources }}
          singleChoiceDetail="This is the only eligible published Blueprint in this Library draft."
        />
      </div>

      <div className="rule-config-actions">
        <button
          type="button"
          className="ghost"
          onClick={bindBlueprint}
          disabled={!selectedOfferId || !selectedBlueprintKey || currentBlueprintKey === selectedBlueprintKey}
        >
          Bind Blueprint to Offer
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => onPatchPackageField?.(selectedOfferId, "deliveryBlueprintRef", null)}
          disabled={!selectedOfferId || !currentBlueprintKey}
        >
          Remove Offer binding
        </button>
        <label className="admin-inline-toggle">
          <input
            type="checkbox"
            checked={assessment.enabled}
            disabled={!assessment.canEnable && !assessment.enabled}
            onChange={(event) => onPatchSetting?.("deliveryPlanningEnabled", event.target.checked)}
          />
          <span>Enable Delivery Planning after save</span>
        </label>
      </div>

      {visibleIssues.length > 0 ? (
        <div className="warning-note" role="status">
          <strong>{visibleIssues.length} configuration item{visibleIssues.length === 1 ? "" : "s"} need review.</strong>
          <ul>
            {visibleIssues.slice(0, 6).map((entry, index) => (
              <li key={`${entry.id}-${entry.path}-${index}`}>{entry.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <details ref={sourceDetailsRef} className="admin-menu-disclosure pricing-policy-child">
        <summary>
          <span>Reviewed source</span>
          <small>Exact versioned declarations; no generated ratios or inferred policy.</small>
        </summary>
        <div className="admin-menu-disclosure-body">
          {[
            ["deliveryBlueprints", "Delivery Blueprints JSON", "Published Blueprints need exact revisions, work blocks, capabilities, and versioned quantity-policy references."],
            ["quantityPolicies", "Quantity Policies JSON", "Published policies need declared guest bounds, integer quantity math, provenance, and versioned purchasing-pack references."],
            ["purchasingPacks", "Purchasing Packs JSON", "Published packs keep pack quantity and unit separate from current stock or supplier commitment."]
          ].map(([field, label, hint]) => (
            <label key={field} className="json-label">
              <span>{label}</span>
              <textarea
                className="json-editor"
                value={jsonDrafts?.[field] || "[]"}
                onChange={(event) => onPatchJson?.(field, event.target.value)}
                aria-label={label}
              />
              <small>{hint}</small>
            </label>
          ))}
        </div>
      </details>
    </section>
  );
}
