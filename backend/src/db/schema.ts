import { pgTable, uuid, text, timestamp, boolean, integer, pgEnum, index, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const roleEnum = pgEnum("role", ["member", "pending_pastor", "pastor", "admin", "super_admin"]);
export const pastorStatusEnum = pgEnum("pastor_status", ["pending", "approved", "rejected"]);
export const languageEnum = pgEnum("language", ["am", "en"]);
export const resourceCategoryEnum = pgEnum("resource_category", ["sermon_notes", "study_guide", "calendar", "announcement_doc", "other"]);
export const churchRequestStatusEnum = pgEnum("church_request_status", ["pending", "approved", "rejected"]);

// Better Auth manages its own users table — we reference it
export const churches = pgTable("churches", {
  id: uuid("id").primaryKey().defaultRandom(),
  nameAm: text("name_am").notNull(),
  nameEn: text("name_en").notNull(),
  denomination: text("denomination"),
  city: text("city"),
  telegramChatId: text("telegram_chat_id"),
  telegramVerifiedAt: timestamp("telegram_verified_at", { withTimezone: true }),
  memberCount: integer("member_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const branches = pgTable("branches", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").notNull().references(() => churches.id, { onDelete: "cascade" }),
  nameAm: text("name_am").notNull(),
  nameEn: text("name_en").notNull(),
  createdBy: uuid("created_by").references((): AnyPgColumn => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("branches_church_id_idx").on(table.churchId),
]);

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  phone: text("phone").unique(),
  churchId: uuid("church_id").notNull().references(() => churches.id),
  branchId: uuid("branch_id").references((): AnyPgColumn => branches.id),
  role: roleEnum("role").notNull().default("member"),
  language: languageEnum("language").notNull().default("am"),
  churchRole: text("church_role"),
  pastorStatus: pastorStatusEnum("pastor_status"),
  pastorDocPath: text("pastor_doc_path"),
  pastorRejectedReason: text("pastor_rejected_reason"),
  pastorRequestedAt: timestamp("pastor_requested_at", { withTimezone: true }),
  /** Branch the applicant says they lead. Becomes a real branch on approval. */
  pastorBranchName: text("pastor_branch_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("profiles_church_id_idx").on(table.churchId),
  uniqueIndex("profiles_phone_idx").on(table.phone),
]);

export const churchRequests = pgTable("church_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestedBy: uuid("requested_by").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  nameEn: text("name_en").notNull(),
  nameAm: text("name_am"),
  city: text("city"),
  denomination: text("denomination"),
  status: churchRequestStatusEnum("status").notNull().default("pending"),
  createdChurchId: uuid("created_church_id").references(() => churches.id, { onDelete: "set null" }),
  rejectedReason: text("rejected_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("church_requests_status_idx").on(table.status),
  index("church_requests_requester_idx").on(table.requestedBy),
]);

export const telegramLinkCodes = pgTable("telegram_link_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").notNull().references(() => churches.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").notNull().references((): AnyPgColumn => profiles.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  chatId: text("chat_id"),
  chatTitle: text("chat_title"),
  redeemedByTelegramId: text("redeemed_by_telegram_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("telegram_link_codes_code_idx").on(table.code),
  index("telegram_link_codes_church_created_idx").on(table.churchId, table.createdAt),
]);

export const announcements = pgTable("announcements", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").notNull().references(() => churches.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => profiles.id),
  titleAm: text("title_am").notNull(),
  titleEn: text("title_en").notNull(),
  body: text("body").notNull(),
  locked: boolean("locked").notNull().default(false),
  postedToTelegram: boolean("posted_to_telegram").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("announcements_church_id_created_at_idx").on(table.churchId, table.createdAt),
]);

export const replies = pgTable("replies", {
  id: uuid("id").primaryKey().defaultRandom(),
  announcementId: uuid("announcement_id").notNull().references(() => announcements.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => profiles.id),
  authorName: text("author_name").notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("replies_announcement_id_created_at_idx").on(table.announcementId, table.createdAt),
]);

export const resources = pgTable("resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id").notNull().references(() => churches.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => branches.id),
  uploadedBy: uuid("uploaded_by").notNull().references(() => profiles.id),
  titleAm: text("title_am").notNull(),
  titleEn: text("title_en").notNull(),
  description: text("description"),
  category: resourceCategoryEnum("category").notNull(),
  filePath: text("file_path").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  mimeType: text("mime_type").notNull(),
  rightsConfirmed: boolean("rights_confirmed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("resources_church_id_created_at_idx").on(table.churchId, table.createdAt),
]);

// Better Auth users table (minimal, rest handled by better-auth)
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  phone: text("phone").unique(),
  phoneVerified: boolean("phone_verified").notNull().default(false),
  passwordHash: text("password_hash"),
  /**
   * Better Auth's user model carries these two; Birhan never has. The display
   * name people actually see lives on `profiles.displayName`. They exist so the
   * drizzle adapter can map its `user` model onto this table — nothing writes
   * them, because Better Auth's account-creating routes are disabled.
   */
  name: text("name"),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Better Auth's own tables.
 *
 * Separate from anything Birhan reads. `auth_accounts` and `auth_verifications`
 * stay empty in normal operation — account creation is the atomic transaction in
 * routes/auth.ts and nowhere else — but the adapter needs a model for each name
 * it knows about or it throws at request time rather than at boot.
 *
 * `auth_jwks` is the one that carries real weight: the jwt plugin stores its
 * signing key pair there, and without it /api/auth/jwks cannot answer.
 */
export const authAccounts = pgTable("auth_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("auth_accounts_user_id_idx").on(table.userId),
  uniqueIndex("auth_accounts_provider_account_idx").on(table.providerId, table.accountId),
]);

export const authVerifications = pgTable("auth_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("auth_verifications_identifier_idx").on(table.identifier),
]);

export const authJwks = pgTable("auth_jwks", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  /**
   * Optional in better-auth's model but the column must exist regardless — the
   * adapter validates the whole field list and refuses the model if any of them
   * is missing.
   */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  /** Signing algorithm. */
  alg: text("alg"),
  /** Curve, for EdDSA/ECDSA key pairs. */
  crv: text("crv"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Email verification tokens, split-token style.
 *
 * `selector` is public and indexed — it is what the lookup runs on, so the
 * database never has to search on a secret. `verifier_hash` is sha256 of the
 * secret half; the secret itself is never stored, so a database leak cannot be
 * replayed into account takeovers. The two halves travel together in the link
 * as `selector.verifier`.
 *
 * Rows are kept after consumption: a second click on the same link has to be
 * told "already used, want a new one?" rather than "invalid", and the row is
 * also what the 3-per-hour resend limit counts.
 */
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  selector: text("selector").notNull().unique(),
  verifierHash: text("verifier_hash").notNull(),
  /**
   * The address the token was issued for. Checked again at verification so a
   * link mailed to an old address cannot verify a new one after an email change.
   */
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  /**
   * False for the token minted by signup, true for one the user asked for. The
   * 3-per-hour resend budget counts resends only, so the signup mail does not
   * eat into it.
   */
  isResend: boolean("is_resend").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("email_verification_tokens_user_id_created_at_idx").on(table.userId, table.createdAt),
]);

// Better Auth sessions table
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Relations
export const churchesRelations = relations(churches, ({ many }) => ({
  branches: many(branches),
  profiles: many(profiles),
  announcements: many(announcements),
  resources: many(resources),
}));

export const branchesRelations = relations(branches, ({ one, many }) => ({
  church: one(churches, { fields: [branches.churchId], references: [churches.id] }),
  profiles: many(profiles),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  church: one(churches, { fields: [profiles.churchId], references: [churches.id] }),
  branch: one(branches, { fields: [profiles.branchId], references: [branches.id] }),
}));

export const announcementsRelations = relations(announcements, ({ one, many }) => ({
  church: one(churches, { fields: [announcements.churchId], references: [churches.id] }),
  author: one(profiles, { fields: [announcements.authorId], references: [profiles.id] }),
  replies: many(replies),
}));

export const repliesRelations = relations(replies, ({ one }) => ({
  announcement: one(announcements, { fields: [replies.announcementId], references: [announcements.id] }),
  author: one(profiles, { fields: [replies.authorId], references: [profiles.id] }),
}));

export const resourcesRelations = relations(resources, ({ one }) => ({
  church: one(churches, { fields: [resources.churchId], references: [churches.id] }),
  branch: one(branches, { fields: [resources.branchId], references: [branches.id] }),
  uploader: one(profiles, { fields: [resources.uploadedBy], references: [profiles.id] }),
}));

export const churchRequestsRelations = relations(churchRequests, ({ one }) => ({
  requester: one(profiles, { fields: [churchRequests.requestedBy], references: [profiles.id] }),
  createdChurch: one(churches, { fields: [churchRequests.createdChurchId], references: [churches.id] }),
}));

export const emailVerificationTokensRelations = relations(emailVerificationTokens, ({ one }) => ({
  user: one(users, { fields: [emailVerificationTokens.userId], references: [users.id] }),
}));
