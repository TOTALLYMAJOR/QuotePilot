import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState
} from "react";
import {
  acknowledgeWorkspaceActionFeedback,
  beginWorkspaceActionFeedback,
  createWorkspaceActionFeedbackRegistry,
  transitionWorkspaceActionFeedback
} from "../lib/workspaceActionFeedback";
import { WorkspaceActionFeedbackAnnouncer } from "../components/WorkspaceActionFeedbackNotice";

const WorkspaceActionFeedbackContext = createContext(null);

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => freeze(value[key], seen));
  return Object.freeze(value);
}

function unavailableResult() {
  return freeze({
    ok: false,
    status: "rejected",
    reason: "feedback_provider_unavailable",
    registry: null,
    record: null,
    selector: null,
    announcement: null
  });
}

const NOOP_RESULT = unavailableResult();
const NOOP_CONTEXT = freeze({
  available: false,
  feedbackRecords: [],
  currentFeedback: null,
  announcement: null,
  beginActionFeedback: () => NOOP_RESULT,
  transitionActionFeedback: () => NOOP_RESULT,
  acknowledgeActionFeedback: () => NOOP_RESULT
});

function scopeKey(scope) {
  return `${scope.organizationId}\u0000${scope.principalId}\u0000${scope.role}`;
}

function selectorFromInput(input, registry, scope) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const attemptId = input.attemptId;
  const generation = input.generation;
  const recordRevision = input.recordRevision ?? input.revision;
  const record = registry.records.find((candidate) => (
    candidate.attemptId === attemptId && candidate.generation === generation
  ));
  if (!record) {
    return {
      scope: input.scope ?? scope,
      attemptId,
      generation,
      actionId: input.actionId,
      object: input.object,
      recordRevision
    };
  }
  return {
    scope: input.scope ?? scope,
    attemptId,
    generation,
    actionId: input.actionId ?? record.actionId,
    object: input.object ?? record.object,
    recordRevision
  };
}

function announcementBelongsToRecord(announcement, record) {
  return Boolean(
    announcement
    && record
    && announcement.attemptId === record.attemptId
    && announcement.generation === record.generation
    && announcement.recordRevision === record.revision
    && announcement.phase === record.phase
  );
}

function ActiveWorkspaceActionFeedbackProvider({
  children,
  initialRegistry,
  clock,
  idFactory
}) {
  const [registry, setRegistry] = useState(initialRegistry);
  const [announcement, setAnnouncement] = useState(null);
  const registryRef = useRef(initialRegistry);
  const clockRef = useRef(clock);
  const idFactoryRef = useRef(idFactory);
  clockRef.current = clock;
  idFactoryRef.current = idFactory;

  const applyResult = useCallback((result) => {
    if (!result.ok) return result;
    if (result.registry !== registryRef.current) {
      registryRef.current = result.registry;
      setRegistry(result.registry);
    }
    if (result.announcement) {
      setAnnouncement((current) => (
        current?.id === result.announcement.id ? current : result.announcement
      ));
    }
    return result;
  }, []);

  const beginActionFeedback = useCallback((input) => {
    const result = beginWorkspaceActionFeedback(
      registryRef.current,
      {
        ...input,
        scope: registryRef.current.scope
      },
      {
        clock: clockRef.current,
        idFactory: idFactoryRef.current
      }
    );
    return applyResult(result);
  }, [applyResult]);

  const transitionActionFeedback = useCallback((input) => {
    const selector = selectorFromInput(
      input,
      registryRef.current,
      registryRef.current.scope
    );
    const result = transitionWorkspaceActionFeedback(
      registryRef.current,
      {
        ...input,
        ...selector
      },
      { clock: clockRef.current }
    );
    return applyResult(result);
  }, [applyResult]);

  const acknowledgeActionFeedback = useCallback((input) => {
    const selector = selectorFromInput(
      input,
      registryRef.current,
      registryRef.current.scope
    );
    const result = acknowledgeWorkspaceActionFeedback(registryRef.current, selector);
    const applied = applyResult(result);
    if (applied.ok) {
      // Removing the current record must not leave its old live announcement
      // behind. A queued record becomes current visually, but is not announced
      // again because acknowledgement did not change that queued record.
      setAnnouncement((current) => (
        announcementBelongsToRecord(current, applied.record) ? null : current
      ));
    }
    return applied;
  }, [applyResult]);

  const value = useMemo(() => ({
    available: true,
    feedbackRecords: registry.records,
    currentFeedback: registry.records[0] || null,
    announcement,
    beginActionFeedback,
    transitionActionFeedback,
    acknowledgeActionFeedback
  }), [
    acknowledgeActionFeedback,
    announcement,
    beginActionFeedback,
    registry.records,
    transitionActionFeedback
  ]);

  return (
    <WorkspaceActionFeedbackContext.Provider value={value}>
      <WorkspaceActionFeedbackAnnouncer
        announcement={announcement}
        feedback={registry.records[0] || null}
      />
      {children}
    </WorkspaceActionFeedbackContext.Provider>
  );
}

export function WorkspaceActionFeedbackProvider({
  scope,
  children,
  clock,
  idFactory
}) {
  const created = createWorkspaceActionFeedbackRegistry(scope);
  if (!created.ok) {
    return (
      <WorkspaceActionFeedbackContext.Provider value={NOOP_CONTEXT}>
        {children}
      </WorkspaceActionFeedbackContext.Provider>
    );
  }
  return (
    <ActiveWorkspaceActionFeedbackProvider
      key={scopeKey(created.registry.scope)}
      initialRegistry={created.registry}
      clock={clock}
      idFactory={idFactory}
    >
      {children}
    </ActiveWorkspaceActionFeedbackProvider>
  );
}

export function useWorkspaceActionFeedback() {
  return useContext(WorkspaceActionFeedbackContext) || NOOP_CONTEXT;
}

export default WorkspaceActionFeedbackContext;
