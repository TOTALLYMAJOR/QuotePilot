import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import "./ambient.css";

function scheduleFrame(callback) {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    const frame = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame?.(frame);
  }
  const timer = setTimeout(callback, 0);
  return () => clearTimeout(timer);
}

function editorValue(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function validationMessage(result) {
  if (typeof result === "string") return result.trim();
  if (result === false) return "Review this value before applying it.";
  return "";
}

const InlineValue = forwardRef(function InlineValue({
  label,
  value,
  displayValue,
  onCommit,
  validate,
  parseValue,
  disabled = false,
  inputType = "text",
  inputMode,
  editorProps = {},
  editLabel,
  commitLabel = "Apply change",
  pendingLabel = "Applying change",
  cancelLabel = "Cancel",
  onEditStart,
  onCancel,
  onCommitStart,
  onValidationError,
  onCommitError,
  editActionId,
  commitActionId,
  cancelActionId,
  className = ""
}, forwardedRef) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const triggerRef = useRef(null);
  const inputRef = useRef(null);
  const mountedRef = useRef(true);
  const restoreFocusRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => editorValue(value));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useImperativeHandle(forwardedRef, () => triggerRef.current);

  const canEdit = !disabled && typeof onCommit === "function";
  const visibleValue = displayValue ?? (value === "" || value === null || value === undefined ? "Not set" : value);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!editing) return undefined;
    return scheduleFrame(() => {
      inputRef.current?.focus();
      if (inputType !== "number" && typeof inputRef.current?.select === "function") {
        inputRef.current.select();
      }
    });
  }, [editing, inputType]);

  useEffect(() => {
    if (editing || !restoreFocusRef.current) return undefined;
    restoreFocusRef.current = false;
    return scheduleFrame(() => triggerRef.current?.focus());
  }, [editing]);

  function restoreTriggerFocus() {
    restoreFocusRef.current = true;
  }

  function beginEditing() {
    if (!canEdit) return;
    const nextDraft = editorValue(value);
    setDraft(nextDraft);
    setError("");
    setEditing(true);
    onEditStart?.({ value, draft: nextDraft });
  }

  function cancelEditing() {
    if (pending) return;
    const cancelledDraft = draft;
    setDraft(editorValue(value));
    setError("");
    setEditing(false);
    onCancel?.({ value, draft: cancelledDraft });
    restoreTriggerFocus();
  }

  async function commitDraft(event) {
    event?.preventDefault?.();
    if (pending || !canEdit) return;

    let nextValue;
    let commitContext;
    try {
      const issue = validationMessage(validate?.(draft, value));
      if (issue) {
        setError(issue);
        onValidationError?.({ value, draft, message: issue });
        inputRef.current?.focus();
        return;
      }
      nextValue = typeof parseValue === "function" ? parseValue(draft, value) : draft;
    } catch (validationError) {
      const message = validationError?.userMessage || "Review this value before applying it.";
      setError(message);
      onValidationError?.({ value, draft, message });
      inputRef.current?.focus();
      return;
    }
    commitContext = onCommitStart?.({ value, draft, nextValue });

    setError("");
    setPending(true);
    try {
      const result = await onCommit(nextValue, { previousValue: value, draft, commitContext });
      if (!mountedRef.current) return;
      if (result === false) {
        setPending(false);
        const message = "This change was not applied. Review it and try again.";
        setError(message);
        onCommitError?.({ value, draft, nextValue, message, commitContext });
        inputRef.current?.focus();
        return;
      }
      setPending(false);
      setEditing(false);
      restoreTriggerFocus();
    } catch (commitError) {
      if (!mountedRef.current) return;
      setPending(false);
      const message = commitError?.userMessage || "This change could not be applied. Try again.";
      setError(message);
      onCommitError?.({ value, draft, nextValue, message, commitContext });
      inputRef.current?.focus();
    }
  }

  const rootClassName = [
    "ambient-inline-value",
    editing && "ambient-inline-value--editing",
    disabled && "ambient-inline-value--disabled",
    className
  ].filter(Boolean).join(" ");

  if (!editing) {
    return (
      <div className={rootClassName} data-ambient-inline-state={canEdit ? "ready" : "read-only"}>
        <button
          ref={triggerRef}
          type="button"
          className="ambient-inline-value__trigger"
          onClick={beginEditing}
          disabled={!canEdit}
          data-ambient-action-id={editActionId || undefined}
          aria-label={editLabel || `Change ${label}`}
        >
          <span className="ambient-inline-value__label">{label}</span>
          <span className="ambient-inline-value__content">{visibleValue}</span>
        </button>
      </div>
    );
  }

  const {
    className: editorClassName = "",
    onChange: onEditorChange,
    onKeyDown: onEditorKeyDown,
    ...nativeEditorProps
  } = editorProps;

  return (
    <form
      className={rootClassName}
      data-ambient-inline-state={pending ? "pending" : error ? "recovery" : "editing"}
      aria-busy={pending ? "true" : undefined}
      noValidate
      onSubmit={commitDraft}
    >
      <label className="ambient-inline-value__label" htmlFor={inputId}>{label}</label>
      <div className="ambient-inline-value__editor-row">
        <input
          {...nativeEditorProps}
          ref={inputRef}
          id={inputId}
          className={["ambient-inline-value__input", editorClassName].filter(Boolean).join(" ")}
          type={inputType}
          inputMode={inputMode}
          value={draft}
          disabled={pending}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? errorId : nativeEditorProps["aria-describedby"]}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError("");
            onEditorChange?.(event);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelEditing();
              return;
            }
            onEditorKeyDown?.(event);
          }}
        />
        <button
          type="submit"
          className="ambient-inline-value__commit"
          disabled={pending}
          data-ambient-action-id={commitActionId || undefined}
        >
          {pending ? pendingLabel : commitLabel}
        </button>
        <button
          type="button"
          className="ambient-inline-value__cancel"
          onClick={cancelEditing}
          disabled={pending}
          data-ambient-action-id={cancelActionId || undefined}
        >
          {cancelLabel}
        </button>
      </div>
      {error && <p id={errorId} className="ambient-inline-value__error" role="alert">{error}</p>}
    </form>
  );
});

export default InlineValue;
