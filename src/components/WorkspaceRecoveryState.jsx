import "./workspaceRecoveryState.css";

export default function WorkspaceRecoveryState({
  eyebrow,
  title,
  description,
  titleId,
  children,
  className = "",
  actionGroupLabel = "Recovery actions",
  ...sectionProps
}) {
  const classes = ["workspace-recovery-state", className].filter(Boolean).join(" ");

  return (
    <section
      {...sectionProps}
      className={classes}
      aria-labelledby={titleId}
    >
      <p className="eyebrow">{eyebrow}</p>
      <h3 id={titleId}>{title}</h3>
      <p>{description}</p>
      {children && (
        <div
          className="workspace-recovery-state__actions"
          role="group"
          aria-label={actionGroupLabel}
          data-layout-audit-group={`${titleId}-actions`}
        >
          {children}
        </div>
      )}
    </section>
  );
}
