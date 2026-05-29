import { useEffect, useMemo, useState } from "react";
import {
  cacheTenantContext,
  getCurrentHostname,
  getHostType,
  readCachedTenantContext,
  resolveTenantByHost
} from "../lib/tenantDomainService";

function baseState() {
  const hostname = getCurrentHostname();
  return {
    loading: true,
    blocked: false,
    error: "",
    hostname,
    hostType: getHostType(hostname),
    organizationId: "",
    active: false,
    environment: "",
    brandingRef: "",
    resolvedAtISO: "",
    source: "bootstrap"
  };
}

function buildNonTenantContext(hostname = "", hostType = "unknown") {
  return {
    loading: false,
    blocked: hostType === "unknown" || hostType === "reserved",
    error: hostType === "unknown" || hostType === "reserved"
      ? "Tenant host is not recognized."
      : "",
    hostname,
    hostType,
    organizationId: "",
    active: hostType !== "unknown" && hostType !== "reserved",
    environment: hostType === "local" ? "local" : "prod",
    brandingRef: "",
    resolvedAtISO: new Date().toISOString(),
    source: "host-type"
  };
}

export function useTenantContext() {
  const [state, setState] = useState(() => baseState());

  useEffect(() => {
    let alive = true;
    const hostname = getCurrentHostname();
    const hostType = getHostType(hostname);

    if (hostType !== "tenant") {
      setState(buildNonTenantContext(hostname, hostType));
      return () => {
        alive = false;
      };
    }

    const cached = readCachedTenantContext(hostname);
    if (cached) {
      setState({
        loading: false,
        blocked: !cached.active || !cached.organizationId,
        error: !cached.active || !cached.organizationId ? "Tenant host is not active." : "",
        hostname: cached.hostname || hostname,
        hostType: cached.hostType || "tenant",
        organizationId: cached.organizationId || "",
        active: cached.active !== false,
        environment: cached.environment || "prod",
        brandingRef: cached.brandingRef || "",
        resolvedAtISO: cached.resolvedAtISO || new Date().toISOString(),
        source: cached.source || "cache"
      });
      return () => {
        alive = false;
      };
    }

    async function run() {
      try {
        const resolved = await resolveTenantByHost(hostname);
        if (!alive) return;
        const nextState = {
          loading: false,
          blocked: !resolved.active || !resolved.organizationId,
          error: !resolved.active || !resolved.organizationId ? "Tenant host is not active." : "",
          hostname: resolved.hostname || hostname,
          hostType: resolved.hostType || "tenant",
          organizationId: resolved.organizationId || "",
          active: resolved.active !== false,
          environment: resolved.environment || "prod",
          brandingRef: resolved.brandingRef || "",
          resolvedAtISO: resolved.resolvedAtISO || new Date().toISOString(),
          source: resolved.source || "resolver"
        };
        setState(nextState);
        cacheTenantContext(hostname, nextState, { negative: nextState.blocked });
      } catch (err) {
        if (!alive) return;
        const blockedState = {
          loading: false,
          blocked: true,
          error: err?.message || "Tenant host is not recognized.",
          hostname,
          hostType: "tenant",
          organizationId: "",
          active: false,
          environment: "prod",
          brandingRef: "",
          resolvedAtISO: new Date().toISOString(),
          source: "resolver-error"
        };
        setState(blockedState);
        cacheTenantContext(hostname, blockedState, { negative: true });
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, []);

  return useMemo(() => ({
    ...state,
    ready: !state.loading && !state.blocked,
    requiresTenant: state.hostType === "tenant"
  }), [state]);
}

