import { useEffect, useMemo, useState } from "react";

export default function UnifiedCommercialConsequenceReview({
  review,
  scopeCurrent = false,
  busy = false,
  onApplyAll,
  onApplySelected,
  onKeepQuotedPlan
}) {
  const allIdsKey = JSON.stringify(review?.selectableRecommendationIds || []);
  const allIds = useMemo(() => JSON.parse(allIdsKey), [allIdsKey]);
  const [selectedIds, setSelectedIds] = useState(allIds);
  useEffect(() => {
    setSelectedIds(JSON.parse(allIdsKey));
  }, [allIdsKey, review?.fence?.proposedRevisionId]);
  if (!review) return null;

  const toggle = (id) => {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((entry) => entry !== id)
      : [...current, id]);
  };
  const disabled = busy || !scopeCurrent;
  return (
    <section
      className="unified-consequence-review"
      data-capability-id="unified-commercial-consequence-review"
      data-capability-state={disabled ? "stale" : "success"}
      aria-labelledby="unified-consequence-title"
    >
      <div className="workflow-attention-head">
        <div>
          <p className="eyebrow">One consequence review</p>
          <h4 id="unified-consequence-title">Choose the exact proposed plan</h4>
          <p className="source-note">Authoritative effects and policy recommendations are labeled separately. These controls stage a form and rerun simulation; they do not save a quote.</p>
        </div>
      </div>

      <div className="unified-consequence-review__groups">
        {review.groups.map((group) => (
          <section key={group.id} className="unified-consequence-review__group" data-consequence-group={group.id}>
            <h5>{group.label}</h5>
            {group.items.length === 0 ? (
              <p className="muted">No consequence identified in this simulation.</p>
            ) : (
              <ul>
                {group.items.map((entry) => (
                  <li key={entry.id}>
                    {entry.selectable ? (
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(entry.id)}
                          onChange={() => toggle(entry.id)}
                          disabled={disabled}
                        />
                        <span><strong>{entry.label}</strong><small>{entry.detail}</small></span>
                      </label>
                    ) : (
                      <span><strong>{entry.label}</strong><small>{entry.detail}</small></span>
                    )}
                    <em data-consequence-source={entry.authority}>{entry.source}</em>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {!scopeCurrent && <p className="warning-note" role="alert">The quote, catalog, or simulation fence changed. Refresh consequence review before choosing an outcome.</p>}
      <div className="right-actions">
        <button type="button" className="ghost compact" onClick={onKeepQuotedPlan} disabled={busy}>Keep quoted plan</button>
        <button type="button" className="ghost compact" onClick={() => onApplySelected?.(selectedIds)} disabled={disabled || selectedIds.length === 0}>Stage selected in form</button>
        <button type="button" className="cta compact" onClick={() => onApplyAll?.(allIds)} disabled={disabled}>Stage all in form</button>
      </div>
      <p className="workflow-attention-boundary" role="note">Stage actions rebuild an exact proposed form and require a fresh server-authoritative simulation before the existing governed version action can run. They do not save, approve, or authoritatively apply a quote. Keep discards only this unsaved proposal.</p>
    </section>
  );
}
