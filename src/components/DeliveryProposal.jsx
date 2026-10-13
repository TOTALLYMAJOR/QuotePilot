import { useMemo, useRef, useState } from "react";
import {
  buildDeliveryPlanningContext,
  createDeliveryHandoff,
  deliveryFingerprint,
  keepDeliveryOverride,
  useGeneratedDeliveryQuantity
} from "../lib/deliveryPlanning";
import "./deliveryProposal.css";

const EVIDENCE_LABELS = Object.freeze({
  available: "Current evidence",
  not_applicable: "Not applicable",
  not_yet_available: "Unchecked",
  missing: "Missing",
  stale: "Stale",
  blocked_by_integration: "Blocked",
  contradictory: "Contradictory",
  schema_drift: "Schema drift"
});

function quantity(value, unitId = "unit") {
  if (value === null || value === undefined) return "Unchecked";
  return `${Math.round(Number(value) * 1000) / 1000} ${unitId}`;
}

function micros(value, unitId = "unit") {
  if (value === null || value === undefined) return "Unchecked";
  return quantity(Number(value) / 1_000_000, unitId);
}

function timing(block) {
  const offset = Number(block.timing.offsetMinutes);
  const relative = offset === 0
    ? "at service start"
    : `${Math.abs(offset)} min ${offset < 0 ? "before" : "after"} service start`;
  return `${relative} · ${block.timing.durationMinutes} min`;
}

function EvidenceItem({ label, value }) {
  const state = value?.state || "missing";
  return (
    <li data-evidence-state={state}>
      <span>{label}</span>
      <strong>{EVIDENCE_LABELS[state] || state}</strong>
      {value?.reasonCode ? <small>{String(value.reasonCode).replaceAll("_", " ")}</small> : null}
    </li>
  );
}

export default function DeliveryProposal({
  form,
  catalog,
  settings,
  editingQuote = null,
  staffingEvidence = null,
  inventoryEvidence = null,
  operatorId = "",
  onHandoff = null
}) {
  const [overrides, setOverrides] = useState({});
  const [removedOptionalComponentIds, setRemovedOptionalComponentIds] = useState([]);
  const [editingOutputId, setEditingOutputId] = useState("");
  const [overrideDraft, setOverrideDraft] = useState({ quantity: "", reason: "" });
  const [notice, setNotice] = useState("");
  const generationRef = useRef({ key: "", value: 0 });
  const generationKey = deliveryFingerprint({
    guests: form?.guests,
    pkg: form?.pkg,
    style: form?.style,
    menuItems: form?.menuItems,
    catalogRevision: settings?.catalogRevision,
    blueprintRefs: (catalog?.packages || []).map((item) => item?.deliveryBlueprintRef),
    overrides,
    removedOptionalComponentIds
  });
  if (generationRef.current.key !== generationKey) {
    generationRef.current = {
      key: generationKey,
      value: generationRef.current.value + 1
    };
  }

  const proposal = useMemo(() => buildDeliveryPlanningContext({
    form,
    catalog,
    settings,
    editingQuote,
    staffingEvidence,
    inventoryEvidence,
    overrides,
    removedOptionalComponentIds,
    calculationGeneration: generationRef.current.value
  }), [
    catalog,
    editingQuote,
    form,
    inventoryEvidence,
    overrides,
    removedOptionalComponentIds,
    settings,
    staffingEvidence,
    generationKey
  ]);

  if (!proposal) return null;

  const saveOverride = (output) => {
    const parsed = Number(overrideDraft.quantity);
    const reason = String(overrideDraft.reason || "").trim();
    if (!Number.isSafeInteger(parsed) || parsed < 0 || !reason) {
      setNotice("Enter a whole production quantity and a reason for the override.");
      return;
    }
    setOverrides((current) => ({
      ...current,
      [output.componentId]: {
        quantity: parsed,
        reason,
        declaredBy: String(operatorId || "session operator").trim(),
        declaredAtISO: new Date().toISOString(),
        baseGeneratedQuantity: output.generatedQuantity
      }
    }));
    setEditingOutputId("");
    setNotice(`${output.label} override retained for this session.`);
  };

  const requestHandoff = (domain) => {
    const handoff = createDeliveryHandoff(proposal, domain);
    if (!proposal.bindings.quoteRevisionId) {
      setNotice(`Save the quote before opening ${domain} review.`);
      return;
    }
    if (typeof onHandoff !== "function") {
      setNotice(`${domain[0].toUpperCase()}${domain.slice(1)} handoff is not connected in this release.`);
      return;
    }
    onHandoff(handoff);
  };

  const removedLabels = (proposal.blueprint ? (settings?.deliveryBlueprints || []) : [])
    .find((item) => item?.id === proposal.bindings.blueprintId && String(item?.revision) === proposal.bindings.blueprintRevision)
    ?.productionComponents
    ?.filter((component) => removedOptionalComponentIds.includes(String(component?.componentId)))
    .map((component) => ({ id: String(component.componentId), label: component.label || component.componentId })) || [];

  return (
    <section
      className="delivery-proposal"
      aria-labelledby="delivery-proposal-title"
      data-testid="delivery-proposal"
      data-delivery-proposal-state={proposal.presentation.state}
      data-capability-state={proposal.presentation.state === "conflict" ? "blocked" : "draft"}
    >
      <p className="visually-hidden" role="status" aria-live="polite">{notice}</p>
      <header className="delivery-proposal__head">
        <div>
          <p className="pc-eyebrow">Delivery Proposal</p>
          <h2 id="delivery-proposal-title">{proposal.presentation.label}</h2>
          <p>{proposal.presentation.detail}</p>
        </div>
        <div className="delivery-proposal__identity">
          <strong>{proposal.blueprint?.label || "Blueprint unavailable"}</strong>
          <small>
            {proposal.blueprint
              ? `Blueprint ${proposal.blueprint.revision} · calculation ${proposal.calculationGeneration}`
              : "Review tenant configuration"}
          </small>
        </div>
      </header>

      <div className="delivery-proposal__evidence" aria-label="Delivery evidence by domain">
        <p className="delivery-proposal__label">Evidence stays separate</p>
        <ul>
          <EvidenceItem label="Production" value={proposal.evidence.production} />
          <EvidenceItem label="Staffing" value={proposal.evidence.staffing} />
          <EvidenceItem label="Inventory" value={proposal.evidence.inventory} />
          <EvidenceItem label="Purchasing" value={proposal.evidence.purchasing} />
        </ul>
      </div>

      {proposal.conflicts.length ? (
        <aside className="delivery-proposal__conflicts" aria-labelledby="delivery-proposal-conflicts">
          <h3 id="delivery-proposal-conflicts">Needs operator review</h3>
          <ul>
            {proposal.conflicts.map((conflict, index) => (
              <li key={`${conflict.id}-${conflict.componentId || index}`}>{conflict.message}</li>
            ))}
          </ul>
        </aside>
      ) : null}

      <div className="delivery-proposal__columns">
        <section aria-labelledby="delivery-required-work">
          <p className="delivery-proposal__label">Required work</p>
          <h3 id="delivery-required-work">Work blocks</h3>
          {proposal.workBlocks.length ? (
            <ol className="delivery-proposal__work">
              {proposal.workBlocks.map((block) => (
                <li key={block.id}>
                  <strong>{block.label}</strong>
                  <span>{timing(block)}</span>
                  <small>{block.requiredCapabilities.join(" · ")}</small>
                </li>
              ))}
            </ol>
          ) : <p className="delivery-proposal__empty">No valid work blocks are available.</p>}
        </section>

        <section aria-labelledby="delivery-production-demand">
          <p className="delivery-proposal__label">Production</p>
          <h3 id="delivery-production-demand">Generated output</h3>
          {proposal.productionOutputs.length ? (
            <ul className="delivery-proposal__production">
              {proposal.productionOutputs.map((output) => (
                <li key={output.componentId} data-override-state={output.override?.state || "generated"}>
                  <div>
                    <strong>{output.label}</strong>
                    <span>{quantity(output.productionQuantity, output.unitId)}</span>
                    <small>
                      {output.override
                        ? `Generated ${quantity(output.generatedQuantity, output.unitId)} · session override ${output.override.state}`
                        : `Generated from ${output.quantityPolicy.id} rev ${output.quantityPolicy.revision}`}
                    </small>
                  </div>
                  {output.override?.state === "conflict" ? (
                    <div className="delivery-proposal__row-actions" role="group" aria-label={`Resolve ${output.label} override`}>
                      <button type="button" onClick={() => {
                        setOverrides((current) => keepDeliveryOverride(current, output.componentId, output.generatedQuantity));
                        setNotice(`${output.label} override kept against the new generated quantity.`);
                      }}>Keep override</button>
                      <button type="button" onClick={() => {
                        setOverrides((current) => useGeneratedDeliveryQuantity(current, output.componentId));
                        setNotice(`${output.label} now uses the generated quantity.`);
                      }}>Use generated</button>
                    </div>
                  ) : editingOutputId === output.componentId ? (
                    <div className="delivery-proposal__override-editor">
                      <label>
                        Production quantity
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={overrideDraft.quantity}
                          onChange={(event) => setOverrideDraft((current) => ({ ...current, quantity: event.target.value }))}
                        />
                      </label>
                      <label>
                        Reason
                        <input
                          value={overrideDraft.reason}
                          onChange={(event) => setOverrideDraft((current) => ({ ...current, reason: event.target.value }))}
                        />
                      </label>
                      <div className="delivery-proposal__row-actions">
                        <button type="button" onClick={() => saveOverride(output)}>Keep this quantity</button>
                        <button type="button" onClick={() => setEditingOutputId("")}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="delivery-proposal__row-actions">
                      <button type="button" onClick={() => {
                        setEditingOutputId(output.componentId);
                        setOverrideDraft({
                          quantity: String(output.productionQuantity),
                          reason: output.override?.reason || ""
                        });
                      }}>Adjust quantity</button>
                      {!output.required ? (
                        <button type="button" onClick={() => {
                          setRemovedOptionalComponentIds((current) => [...new Set([...current, output.componentId])]);
                          setNotice(`${output.label} removed from this session proposal.`);
                        }}>Remove optional</button>
                      ) : null}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="delivery-proposal__empty">No production output can be compiled yet.</p>}
          {removedLabels.length ? (
            <div className="delivery-proposal__removed">
              <strong>Removed optional items</strong>
              {removedLabels.map((item) => (
                <button key={item.id} type="button" onClick={() => {
                  setRemovedOptionalComponentIds((current) => current.filter((id) => id !== item.id));
                  setNotice(`${item.label} restored to this session proposal.`);
                }}>Restore {item.label}</button>
              ))}
            </div>
          ) : null}
        </section>

        <section aria-labelledby="delivery-purchasing-demand">
          <p className="delivery-proposal__label">Purchasing</p>
          <h3 id="delivery-purchasing-demand">Ingredient demand</h3>
          {proposal.purchaseRequirements.length ? (
            <ul className="delivery-proposal__purchasing">
              {proposal.purchaseRequirements.map((requirement) => (
                <li key={`${requirement.ingredientId}-${requirement.unitId}`}>
                  <strong>{requirement.label}</strong>
                  <dl>
                    <div><dt>Required</dt><dd>{micros(requirement.requiredIngredientQuantityMicros, requirement.unitId)}</dd></div>
                    <div><dt>Shortage</dt><dd>{micros(requirement.shortageQuantityMicros, requirement.unitId)}</dd></div>
                    <div><dt>Purchase packs</dt><dd>{requirement.purchasablePackQuantity ?? "Unchecked"}</dd></div>
                    <div><dt>Expected remainder</dt><dd>{micros(requirement.expectedRemainderQuantityMicros, requirement.unitId)}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>
          ) : <p className="delivery-proposal__empty">No ingredient demand can be compiled yet.</p>}
        </section>
      </div>

      <footer className="delivery-proposal__footer">
        <p>{proposal.boundary}</p>
        <div className="delivery-proposal__handoffs" aria-label="Delivery review handoffs">
          {[
            ["staffing", "Review staffing"],
            ["production", "Review production"],
            ["purchasing", "Review purchasing"]
          ].map(([domain, label]) => (
            <button
              key={domain}
              type="button"
              onClick={() => requestHandoff(domain)}
              aria-describedby="delivery-handoff-boundary"
            >
              {label}
            </button>
          ))}
        </div>
        <small id="delivery-handoff-boundary">
          Handoffs are prefill-only. The receiving workflow rereads current authority and issues its own receipt.
        </small>
      </footer>
    </section>
  );
}
