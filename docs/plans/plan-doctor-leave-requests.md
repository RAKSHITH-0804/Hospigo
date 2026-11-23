# Plan: doctor leave requests with admin approval

Status: **plan only. Rakshith decided on 23 Nov 2026 that it is built in Step 8c** (after Step 9); answer the questions below and get "approved" when 8c is planned. It needs a migration, a new table with row level security and permission rules, so it is a review gate (CLAUDE.md). Nothing is built.

## What Rakshith asked

Today only an Admin adds leave for a doctor (Settings, Doctors, Availability). He wants doctors to **apply for leave from their own account** and an **Admin to approve** it.

## Behaviour

1. A doctor opens **My profile**, section **My leave**, picks the first and the last day and presses **Request leave**. The request shows as **Waiting**.
2. The doctor sees the state of every request: Waiting, Approved, Rejected, Cancelled. A doctor can cancel a request that is still Waiting.
3. An Admin sees the waiting requests: a **Leave requests** button (with the count) on Settings, Doctors opens a pop-up list with **Approve** and **Reject**. The doctor's Availability pop-up also shows that doctor's waiting requests.
4. **Approve** creates the leave (the existing leave table) in the same transaction, so from then on the doctor cannot be picked on those days (the rule that already exists). **Reject** changes nothing else. A request that is only Waiting blocks nothing.
5. An Admin can still add and remove leave directly, as today.

## Data (one migration, named after `20261127090000`)

New table `doctor_leave_requests`: id, tenant, doctor profile, from date, to date, status (WAITING, APPROVED, REJECTED, CANCELLED), requested by and at, decided by and at, the id of the leave that approval created. Row level security forced, tenant policy like the other tables. The application login gets SELECT, INSERT and UPDATE only (no DELETE: a request is closed, never deleted). No free text is stored; nothing typed goes to the audit trail.

## API (no new permission)

- Doctor, permission `opd.doctors.own` (the doctor is found from the token, never from the request): `POST /doctor-profiles/me/leave-requests`, `GET /doctor-profiles/me/leave-requests`, `POST /doctor-profiles/me/leave-requests/:id/cancel`.
- Admin, permission `opd.doctors.write`, same scope as now (SuperAdmin every doctor, Branch Admin only doctors of their own branches): `GET /opd/leave-requests?status=WAITING`, `POST /opd/leave-requests/:id/approve`, `POST /opd/leave-requests/:id/reject`.
- Same date rules as leave (real dates, end not before start, not in the past, at most 366 days, no overlap with existing leave or another waiting request). Approval checks the overlap again. A person cannot approve their own request. Deciding twice, or two Admins at the same moment, is safe (row lock; the second gets "already decided").
- Audit: kind, ids and dates only.

## Tests

Permissions and scope (doctor only own, Branch Admin only own branch, SuperAdmin all), another hospital, the date rules, approve creates the leave and blocks assignment on those days only, reject and cancel do not block, double and simultaneous decisions, a doctor cannot approve, the web states (loading, empty, error, retry), Postman collection (not run by the assistant).

## Questions for Rakshith

1. Who approves: the SuperAdmin and the Branch Admin of the doctor's branch (as for the rest of the doctors page)?
2. May a doctor cancel leave that was already approved? Proposal: no, an Admin removes it.
3. Should the doctor be able to type a short reason (up to 200 characters)? Proposal: no, to keep personal text out of the audit and the database.
4. Should the Admin be told by email when a request arrives? Proposal: not now (screen only); email later with the other notifications.
5. When: decided, in Step 8c.

## Not in this plan

Leave types and balances (casual, sick), several approval levels, calendar view of all doctors, notifications.
