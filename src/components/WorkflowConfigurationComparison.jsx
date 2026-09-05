const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const role = (value) => value === "admin" ? "Administrator" : "Sales";
const handoff = (value) => ({ internal_event_brief_v1: "Internal event brief", post_event_review_v1: "Post-event review" }[value] || "No manual handoff");
function PackPolicy({ config }) {
  const policy = config.packPolicy;
  if (!policy) return <p>Original event policy: no tenant phase or checkpoint constraints.</p>;
  const words = value => value.replaceAll("_", " ");
  return <dl>{policy.approval && <><dt>Approval participants</dt><dd>{policy.approval.allowedRoles.map(role).join(", ")}</dd><dt>Absolute total change requiring approval</dt><dd>{policy.approval.thresholdCents === null ? "No extra threshold" : `${money(policy.approval.thresholdCents)} USD or more, including zero`}</dd><dd>Governed dependency impact still requires administrator approval.</dd></>}{policy.responsibleRoles && <><dt>Responsible roles</dt><dd>{policy.responsibleRoles.map(role).join(", ")}</dd></>}{Object.hasOwn(policy, "followUpOffsetDays") && <><dt>Follow-up date</dt><dd>{policy.followUpOffsetDays} tenant calendar days after event</dd></>}{policy.phaseConstraints && <>{Object.entries(policy.phaseConstraints).map(([phase, rule]) => <div key={phase}><dt>Before {words(phase)}</dt><dd>Required checkpoints: {rule.requiredCheckpoints.map(words).join(", ") || "None"}. Open urgent issues: {rule.blockOpenUrgentIssues ? "Block transition" : "Do not block transition"}.</dd></div>)}{Object.entries(policy.checkpointPrerequisites).map(([code, required]) => <div key={code}><dt>Before recording {words(code)}</dt><dd>{required.map(words).join(", ") || "No prerequisite checkpoints"}</dd></div>)}</>}</dl>;
}
function Configuration({ config, label }) {
  if (!config) return <div><h4>{label}</h4><p>No active configuration.</p></div>;
  return <div style={{ minWidth: 0 }}><h4>{label}</h4><dl>
    <dt>Definition name</dt><dd>{config.name}</dd><dt>Coordination roles</dt><dd>{config.allowedRoles.map(role).join(", ")}</dd>
    <dt>Actuals review threshold</dt><dd>{config.actualsReviewThresholdCents === null ? "No review threshold declared" : `${money(config.actualsReviewThresholdCents)} USD, inclusive, once capture is complete`}</dd>
    <dt>Comparison tolerances</dt><dd>{config.comparisonPolicy ? `Labor ${(config.comparisonPolicy.laborBasisPoints / 100).toFixed(2)}%; purchasing ${(config.comparisonPolicy.purchasingBasisPoints / 100).toFixed(2)}%; minimum ${money(config.comparisonPolicy.minimumCents)} USD` : "No comparison tolerances declared"}</dd>
    <dt>Workflow due offset</dt><dd>{config.duePolicy.offsetMinutes} minutes after the domain schedule anchor</dd><dt>Escalation</dt><dd>{config.escalationPolicy.afterMinutes} minutes after due, to {role(config.escalationPolicy.role)}</dd>
  </dl><PackPolicy config={config} /><h5>Tasks ({config.taskTemplates.length})</h5>{config.taskTemplates.length === 0 && <p>No named tasks.</p>}{config.taskTemplates.map((task) => <div key={task.taskKey}><strong>{task.label}</strong><p>Task key: {task.taskKey}. Owner: {role(task.ownerRole)}. Due: {task.dueOffsetMinutes} minutes after the domain schedule anchor. {handoff(task.communicationTemplateRef)}.</p><p style={{ whiteSpace: "pre-wrap" }}>{task.instruction || "No additional instruction."}</p></div>)}</div>;
}
export default function WorkflowConfigurationComparison({ current, proposed, proposedLabel = "Proposed configuration" }) {
  return <div aria-label="Configuration changes" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: "1rem", overflowWrap: "anywhere" }}><Configuration label="Current configuration" config={current} /><Configuration label={proposedLabel} config={proposed} /></div>;
}
