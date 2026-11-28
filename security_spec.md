# Security Specification & Payload-First TDD — Utility Hub

## 1. Data Invariants
1. **Unverified Users Blocked**: No user without `request.auth.token.email_verified == true` may create a profile, read organizational data, or write utility entries.
2. **Self-Role Escalation Impossible**: A non-admin user creating `users/{uid}` must have `role == 'viewer'`, `status == 'pending'`, and `companies == []`. Only the configured `ADMIN_EMAIL` (with verified email) may bootstrap as `role == 'admin'` and `status == 'approved'`.
3. **Self-Demotion & Self-Rejection Guard**: Admins cannot modify their own `role` or `status` in `users/{uid}`.
4. **PII Protection & Team Directory**: Only the document owner (`uid == request.auth.uid`) or an approved `admin` can `get` a `users/{uid}` document; only an approved `admin` can `list` `users`. Non-PII organizational identity (`name`, `organization`, `department`, `designation`, `employeeId`, `role`, `status`, `companies`, `viewCompanies`, `allowedUtilities`) is stored in `userDirectory/{uid}` and readable only by approved admins, viewers, or the owner—never exposing `email`, `phone`, or `dailyMailEmail`.
5. **Company-Scoped Entry & Equipment Spec Writes**: Only `admin` or `approved` `entry` users whose `companies` array includes the target factory may create, update, or delete `utilityEntries`, `generationEntries`, `/companies/{companyId}/infrastructure/{docId}`, and `/companies/{companyId}/equipmentSpecs/{specId}`. `viewer` users are strictly read-only. Self-editing `users/{uid}.organization` never grants write access to any company.
6. **Immutability & Server Timestamps**: `createdAt`, `email`, and `createdBy` cannot be altered after creation (neither by users nor by admins). Timestamps must match `request.time`.
7. **Strict Schema & Bounds**: Every string has `.size()` bounds; hex colors match `^#[0-9A-Fa-f]{6}$`; dates match `^\\d{4}-\\d{2}-\\d{2}$`; all quantities, counts, consumption, and costs have strict numeric ranges (`>= 0`); `companies/{companyId}` (factory name, daily entry fuel/device configuration), user `allowedUtilities`, and `dailyMailEnabled`/`dailyMailEmail`/`dailyMailTime`/`lastDailyMailSentDate` may only be modified by admins; self-updates on `users/{uid}` are restricted to `['name', 'organization', 'department', 'designation', 'phone', 'employeeId']`; `/publicConfig/companies` only exposes company names for the sign-up selector (`get` only, no `list`, admin-only writes); shadow/ghost fields are rejected via `keys().hasOnly(...)` and `affectedKeys().hasOnly(...)`.

## 2. Dirty Dozen Payloads (Must Return PERMISSION_DENIED)
1. Unverified user creating `users/{uid}` (`email_verified == false`).
2. Standard user creating `users/{uid}` with `role: "admin"` or `status: "approved"`.
3. Spoofed admin email with `email_verified == false` attempting to create `role: "admin"`.
4. User A attempting to `get` User B's `users/{uidB}` document (or `entry` user attempting to `list` `userDirectory`).
5. Non-admin user attempting to `list` `users` collection or `list` `publicConfig`.
6. User updating their own `users/{uid}` or `userDirectory/{uid}` to alter `email`, `role`, `status`, `companies`, `viewCompanies`, or `allowedUtilities`.
7. Admin attempting to demote or reject themselves (`users/{adminUid}` with changed `role`/`status`).
8. Unapproved (`pending` or `rejected`) user attempting to `read` `companies`, `utilities`, `userDirectory`, `utilityEntries`, `infrastructure`, or `equipmentSpecs`.
9. `viewer` user attempting to `create`, `update`, or `delete` in `companies`, `infrastructure`, `equipmentSpecs`, `utilityEntries`, or `userDirectory/{otherUid}`.
10. `entry` user attempting to create a `utilityEntries` doc or write `/companies/{companyId}/infrastructure` or `/companies/{companyId}/equipmentSpecs` for a factory not in their admin-assigned `companies` array (or forging `companyName`).
11. Any user submitting a shadow field (e.g. `isAdmin: true`) or forged `createdAt`/`updatedAt` timestamp (not `request.time`).
12. Malicious 1MB string or invalid path ID (`../../../etc`) in `companies/{companyId}`, `equipmentSpecs/{specId}`, `utilities/{utilityId}`, `userDirectory/{uid}`, or `utilityEntries/{entryId}`.
