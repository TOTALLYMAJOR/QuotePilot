function normalized(value) {
  return String(value || "").trim();
}

/**
 * Identifies the complete authenticated workspace authority boundary.
 *
 * The resolution phase is intentionally part of the key. When Firebase starts
 * resolving a replacement principal it can briefly retain the prior principal
 * details with `loading: true`; changing the key at that point destroys all
 * tenant-owned UI state before the replacement scope is known or rendered.
 */
export function buildAuthenticatedWorkspaceScopeKey({
  tenantContext = {},
  authSession = {}
} = {}) {
  return JSON.stringify([
    authSession.loading ? "resolving" : "settled",
    normalized(authSession.user?.uid),
    normalized(authSession.organizationId),
    normalized(authSession.role).toLowerCase(),
    authSession.platformAdmin === true ? "platform-admin" : "tenant-user",
    normalized(tenantContext.hostname).toLowerCase(),
    normalized(tenantContext.organizationId)
  ]);
}

export function buildWorkspaceRouteScopeKey({
  publicPortal = false,
  publicPortalToken = "",
  tenantContext = {},
  authSession = {}
} = {}) {
  if (publicPortal || normalized(publicPortalToken)) {
    return JSON.stringify(["public-portal", normalized(publicPortalToken)]);
  }
  return buildAuthenticatedWorkspaceScopeKey({ tenantContext, authSession });
}
