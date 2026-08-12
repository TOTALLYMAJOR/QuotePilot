import { createContext, useContext, useMemo } from "react";
import { createAmbientContextSnapshot } from "../lib/ambientContracts";

const AmbientContext = createContext(null);

export function AmbientContextProvider({ value, children }) {
  const snapshot = useMemo(() => createAmbientContextSnapshot(value), [value]);
  return (
    <AmbientContext.Provider value={snapshot}>
      {children}
    </AmbientContext.Provider>
  );
}

export function useAmbientContext({ optional = false } = {}) {
  const value = useContext(AmbientContext);
  if (!value && !optional) {
    throw new Error("useAmbientContext must be used inside AmbientContextProvider.");
  }
  return value;
}

export default AmbientContext;
