import { useId } from "react";
import FieldStateIndicator from "./FieldStateIndicator";
import "./fieldState.css";

function normalizeOptions(options) {
  if (!Array.isArray(options)) {
    throw new TypeError("AdaptiveChoiceField options must be an array.");
  }

  const seenValues = new Set();
  return options.map((option, index) => {
    if (!option || (typeof option.value !== "string" && typeof option.value !== "number")) {
      throw new TypeError(`AdaptiveChoiceField option ${index + 1} needs a string or number value.`);
    }
    if (typeof option.label !== "string" || option.label.trim() === "") {
      throw new TypeError(`AdaptiveChoiceField option ${index + 1} needs a visible label.`);
    }
    const value = String(option.value);
    if (seenValues.has(value)) {
      throw new RangeError(`AdaptiveChoiceField option value "${value}" is duplicated.`);
    }
    seenValues.add(value);
    return { ...option, value };
  });
}

function assertEmptyState({ emptyState, emptyReason, recoveryAction }) {
  if (!new Set(["blocked", "unavailable"]).has(emptyState)) {
    throw new RangeError("AdaptiveChoiceField emptyState must be blocked or unavailable.");
  }
  if (typeof emptyReason !== "string" || emptyReason.trim() === "") {
    throw new Error("AdaptiveChoiceField requires an emptyReason when no choices are available.");
  }
  if (
    !recoveryAction
    || typeof recoveryAction.label !== "string"
    || recoveryAction.label.trim() === ""
    || (
      typeof recoveryAction.onClick !== "function"
      && (typeof recoveryAction.href !== "string" || recoveryAction.href.trim() === "")
    )
  ) {
    throw new Error("AdaptiveChoiceField requires one actionable recoveryAction when no choices are available.");
  }
}

export function getAdaptiveChoiceMode(options) {
  const count = normalizeOptions(options).length;
  if (count === 0) return "empty";
  if (count === 1) return "single";
  return "select";
}

export default function AdaptiveChoiceField({
  id,
  name,
  label,
  description = "",
  options,
  value,
  defaultValue = "",
  onChange,
  required = false,
  disabled = false,
  placeholder = "Choose an option",
  error = "",
  emptyState = "blocked",
  emptyReason = "",
  recoveryAction,
  singleChoiceDetail = "Only one option is available, so there is nothing to choose.",
  fieldState,
  fieldStateDetails = {},
  className = ""
}) {
  const generatedId = useId();
  const fieldId = id || `adaptive-choice-${generatedId.replace(/:/g, "")}`;
  const descriptionId = description ? `${fieldId}-description` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  const normalizedOptions = normalizeOptions(options);
  const mode = getAdaptiveChoiceMode(normalizedOptions);

  if (typeof label !== "string" || label.trim() === "") {
    throw new TypeError("AdaptiveChoiceField requires a visible label.");
  }

  if (mode === "empty") {
    assertEmptyState({ emptyState, emptyReason, recoveryAction });
    const emptyStateId = `${fieldId}-error`;
    const emptyDescribedBy = [descriptionId, emptyStateId].filter(Boolean).join(" ");
    const state = emptyState === "blocked"
      ? { editability: "blocked" }
      : { availability: "unavailable" };
    return (
      <div
        className={`adaptive-choice-field ${className}`.trim()}
        data-adaptive-choice-mode="empty"
        role="group"
        aria-labelledby={`${fieldId}-label`}
        aria-describedby={emptyDescribedBy}
      >
        <span className="adaptive-choice-field__label" id={`${fieldId}-label`}>
          {label}
        </span>
        {description ? (
          <span className="adaptive-choice-field__description" id={descriptionId}>
            {description}
          </span>
        ) : null}
        <div id={emptyStateId}>
          <FieldStateIndicator
            state={state}
            label={`${label} state`}
            reason={emptyReason}
            recoveryAction={recoveryAction}
          />
        </div>
      </div>
    );
  }

  if (mode === "single") {
    const [onlyOption] = normalizedOptions;
    return (
      <div
        className={`adaptive-choice-field ${className}`.trim()}
        data-adaptive-choice-mode="single"
        role="group"
        aria-labelledby={`${fieldId}-label`}
        aria-describedby={descriptionId}
      >
        <span className="adaptive-choice-field__label" id={`${fieldId}-label`}>
          {label}
        </span>
        {description ? (
          <span className="adaptive-choice-field__description" id={descriptionId}>
            {description}
          </span>
        ) : null}
        <span
          className="adaptive-choice-field__single-value"
          data-adaptive-choice-value={onlyOption.value}
        >
          {onlyOption.label}
        </span>
        {name ? <input type="hidden" name={name} value={onlyOption.value} /> : null}
        <FieldStateIndicator
          state={{ editability: "read_only", evidence: "confirmed" }}
          label={`${label} state`}
          supportingDetail={singleChoiceDetail}
        />
      </div>
    );
  }

  const controlProps = value !== undefined
    ? { value: value == null ? "" : String(value), onChange }
    : { defaultValue: defaultValue == null ? "" : String(defaultValue), onChange };

  return (
    <div
      className={`adaptive-choice-field ${className}`.trim()}
      data-adaptive-choice-mode="select"
    >
      <label className="adaptive-choice-field__label" htmlFor={fieldId}>
        {label}
      </label>
      {description ? (
        <span className="adaptive-choice-field__description" id={descriptionId}>
          {description}
        </span>
      ) : null}
      <select
        {...controlProps}
        className="adaptive-choice-field__select"
        id={fieldId}
        name={name}
        required={required}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={error ? "true" : undefined}
      >
        <option value="" disabled>{placeholder}</option>
        {normalizedOptions.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="adaptive-choice-field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
      {fieldState ? (
        <FieldStateIndicator
          state={fieldState}
          label={`${label} state`}
          {...fieldStateDetails}
        />
      ) : null}
    </div>
  );
}
