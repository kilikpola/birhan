/**
 * Admin console data types — camelCase, matching the Hono backend's JSON.
 */

export type Role = 'member' | 'pending_pastor' | 'pastor' | 'admin' | 'super_admin';
export type PastorStatus = 'pending' | 'approved' | 'rejected';
export type RequestStatus = 'pending' | 'approved' | 'rejected';

/** The signed-in admin (from GET /api/v1/me). */
export type Profile = {
  id: string;
  displayName: string;
  email?: string | null;
  emailVerified?: boolean;
  churchId: string | null;
  branchId: string | null;
  role: Role;
  language: 'am' | 'en';
  churchRole: string | null;
  pastorStatus: PastorStatus | null;
  pastorDocPath: string | null;
  pastorRejectedReason: string | null;
  pastorRequestedAt: string | null;
  pastorBranchName: string | null;
  church?: { nameEn: string; nameAm: string } | null;
  branch?: { nameEn: string } | null;
};

/** Row in GET /api/v1/admin/pastor-applications. */
export type PastorApplication = {
  id: string;
  displayName: string;
  email: string | null;
  churchId: string;
  churchName: string | null;
  branchId: string | null;
  branchName: string | null;
  pastorBranchName: string | null;
  churchRole: string | null;
  role: Role;
  pastorStatus: PastorStatus | null;
  pastorDocPath: string | null;
  pastorRequestedAt: string | null;
  pastorRejectedReason: string | null;
};

/** Row in GET /api/v1/admin/churches. */
export type Church = {
  id: string;
  nameAm: string;
  nameEn: string;
  denomination: string | null;
  city: string | null;
  memberCount: number;
  telegramChatId: string | null;
  telegramVerifiedAt: string | null;
  createdAt: string;
};

/** Row in GET /api/v1/admin/churches/:id/branches. */
export type Branch = {
  id: string;
  nameAm: string;
  nameEn: string;
  /** null → a mother (top-level) branch; a mother's id → a child branch. */
  parentBranchId: string | null;
  createdAt: string;
};

/** Row in GET /api/v1/admin/churches/:id/people. */
export type ChurchPerson = {
  id: string;
  displayName: string;
  email: string | null;
  role: Role;
  churchRole: string | null;
  branchId: string | null;
  branchName: string | null;
  pastorStatus: PastorStatus | null;
  createdAt: string;
};

/**
 * A branch choice sent to approve / make-pastor. At most one field carries
 * meaning: an existing branch, or a name to create. Empty means "leave as is".
 */
export type BranchChoice = {
  branchId?: string;
  newBranchName?: string;
};

/** GET /api/v1/admin/branches/:id/history — current members and ex-members. */
export type BranchHistory = {
  branch: { id: string; name: string };
  current: { id: string; displayName: string; role: Role; email: string | null }[];
  former: {
    profileId: string;
    displayName: string;
    currentBranchName: string | null;
    currentBranchId: string | null;
    leftAt: string | null;
  }[];
};

/** Row in GET /api/v1/admin/church-requests. */
export type ChurchRequest = {
  id: string;
  requestedBy: string;
  requesterName: string | null;
  nameEn: string;
  nameAm: string | null;
  city: string | null;
  denomination: string | null;
  status: RequestStatus;
  createdChurchId: string | null;
  rejectedReason: string | null;
  createdAt: string;
};

/** GET /api/v1/admin/stats. */
export type PlatformStats = {
  churches: number;
  members: number;
  pastors: number;
  pending: number;
  pendingChurchRequests: number;
};

/** Roles that are allowed into this admin console at all. */
export const CONSOLE_ROLES = ['super_admin'] as const;

export function isConsoleRole(role: string | undefined): boolean {
  return !!role && (CONSOLE_ROLES as readonly string[]).includes(role);
}