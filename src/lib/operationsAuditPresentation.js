export function resolveOperationsAuditCapabilityState({
  loading = false,
  recovering = false,
  error = "",
  snapshot = null
} = {}) {
  if (recovering) return "recovery";
  if (loading) return "loading";
  if (String(error || "").trim()) return "error";
  if (snapshot?.sourceTruncated === true) return "partial";
  if (snapshot) return "success";
  return "empty";
}
