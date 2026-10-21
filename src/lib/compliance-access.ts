export type ComplianceAdminRole = "SUPER" | "SECURITY" | "REVIEWER" | "SUPPORT";
export const COMPLIANCE_CASE_TYPES = [
  "COMPLAINT",
  "DISPUTE",
  "PRIVACY_REQUEST",
  "PRIVACY_COMPLAINT",
  "IP_REPORT",
  "MODERATION",
  "VERIFICATION",
  "INCIDENT",
  "OTHER",
] as const;
export type ComplianceCaseType = typeof COMPLIANCE_CASE_TYPES[number];

const roleCaseTypes: Record<Exclude<ComplianceAdminRole, "SUPER">, readonly ComplianceCaseType[]> = {
  SECURITY: ["PRIVACY_REQUEST", "PRIVACY_COMPLAINT", "INCIDENT", "VERIFICATION"],
  REVIEWER: ["COMPLAINT", "DISPUTE", "IP_REPORT", "MODERATION", "VERIFICATION"],
  SUPPORT: ["COMPLAINT", "DISPUTE"],
};

export function caseTypeVisibleToRole(role: string, caseType: string, assignedToId: string | null, userId: string) {
  if (role === "SUPER") return true;
  if (!(["SECURITY", "REVIEWER", "SUPPORT"] as string[]).includes(role)) return false;
  if (!roleCaseTypes[role as Exclude<ComplianceAdminRole, "SUPER">].includes(caseType as ComplianceCaseType)) return false;
  if (role === "SUPPORT") return assignedToId === userId;
  return true;
}

export function caseTypeManageableByRole(role: string, caseType: string, assignedToId: string | null, userId: string) {
  if (!caseTypeVisibleToRole(role, caseType, assignedToId, userId)) return false;
  return role !== "SUPPORT" || assignedToId === userId;
}

export const CASE_STATUSES = ["OPEN", "TRIAGED", "IN_PROGRESS", "WAITING", "ACTION_TAKEN", "RESOLVED", "CLOSED", "REJECTED"] as const;
export const CASE_PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export const TASK_STATUSES = ["OPEN", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"] as const;

const allowedTransitions: Record<string, readonly string[]> = {
  OPEN: ["TRIAGED", "IN_PROGRESS", "WAITING", "ACTION_TAKEN", "RESOLVED", "REJECTED"],
  TRIAGED: ["IN_PROGRESS", "WAITING", "ACTION_TAKEN", "RESOLVED", "REJECTED"],
  IN_PROGRESS: ["WAITING", "ACTION_TAKEN", "RESOLVED", "REJECTED"],
  WAITING: ["IN_PROGRESS", "ACTION_TAKEN", "RESOLVED", "REJECTED"],
  ACTION_TAKEN: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  RESOLVED: ["IN_PROGRESS", "CLOSED"],
  CLOSED: ["IN_PROGRESS"],
  REJECTED: ["IN_PROGRESS", "CLOSED"],
};

export function canTransitionCase(from: string, to: string) {
  return from === to || Boolean(allowedTransitions[from]?.includes(to));
}

export function isOpaqueEvidenceReference(value: string) {
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(trimmed) && !/^(https?:|file:|data:)/i.test(trimmed);
}
