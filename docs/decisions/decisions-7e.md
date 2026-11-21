# Decisions, Step 7e (image and logo upload): migration, API and web

Branch: `feature/phase2-step-7-reports-print-api` (7e is built on top of Steps 7 to 7d; one pull request for all). Built 24 to 25 Nov 2026.

## Answers from Rakshith (planning)

- The **signature or stamp image waits for image upload** (7c), and the **hospital logo** (7) was a marker box until now. 7e gives both a real picture. The step is named 7e (the NestJS 12 upgrade is 8a).
- "Start 7e and tell me when it is 100% complete": no separate approval round was asked for; the plan below was followed and the self-review is at the end.

## What was built

Database (`20261125090000_stored_images`): table `stored_images` (hospital, purpose `HOSPITAL_LOGO` or `DOCTOR_SIGNATURE`, doctor profile for a signature, content type, byte size, width, height, `sha256`, storage key, `is_current`, who made it, when). Row level security enabled and forced. **Rows are never edited (a trigger allows only `is_current` to change) and never deleted (no DELETE grant)**: replacing or removing a picture only stops it being current, so a completed prescription keeps pointing at the signature it was signed with. One current picture per place is enforced by the database (a partial unique index). Checks: purpose, type (PNG, JPEG, WebP only), sizes, hash shape, "a signature has a doctor and a logo does not". The same migration replaces `consultations_guard` so the copy of the doctor's details taken at completion also keeps `signatureImageId`.

API, module `images` (hospital tokens only):

| Route                                                   | Permission                                          | What it does                                                                                 |
| ------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /settings/branding`                                | any signed-in person                                | `{ logo, canWrite, limits }` (the current logo, whether the caller may change it, the rules) |
| `PUT /settings/branding/logo` (multipart field `file`)  | `hospital.settings.write` and a hospital-wide grant | Upload the logo; a Branch Admin of one branch gets `403`                                     |
| `POST /settings/branding/logo/remove`                   | same                                                | Stop using the logo (the old picture stays on record)                                        |
| `GET /images/:id`                                       | any signed-in person (see below)                    | The picture bytes with safe headers                                                          |
| `PUT /doctor-profiles/me/signature`, `POST .../remove`  | `opd.doctors.own`                                   | A doctor's own signature or stamp (found from the token)                                     |
| `PUT /doctor-profiles/:id/signature`, `POST .../remove` | `opd.doctors.write`                                 | An Admin for a doctor in their scope (outside it: `404`)                                     |

The doctor profile views now carry `signature` (the current picture or `null`) and `images` (the limits). `doctorDetails` of a consultation carries `signatureImageId` (the picture the note was completed with; for a draft, the current one). The print layout slot list is now `LOGO` and `SIGNATURE`.

Refusals are `400 SETTINGS_INVALID { field: 'file', reason }` with the reasons `REQUIRED, EMPTY, TOO_BIG, NOT_AN_IMAGE, CORRUPT, TOO_SMALL, TOO_LARGE_PIXELS`; two uploads at the same moment may give `409 STAFF_CONFLICT { reason: 'TRY_AGAIN' }`.

Web: Settings page **Logo** (`/app/settings/branding`, with help); a **Signature or stamp** box in My profile (doctors) and in the open panel of the Doctors page (Admins); the print designer has **Add signature box** beside Add logo box; the three print pages (registration slip, receipt, prescription) now print the logo and, on the prescription, the signature. Route handlers: `/api/staff/branding/logo`, `/api/staff/doctor-profiles/(me|:id)/signature` (upload and remove), and `GET /api/staff/images/:id` so an `<img>` can show a private picture (the access token stays on the server).

## Rules decided while building (not in the plan)

- **The file is judged by its bytes, never by its name or the type the browser claimed.** PNG, JPEG and WebP only; SVG (it can carry scripts), GIF, PDF and the rest are refused. The file must be whole (PNG ends with IEND, JPEG with the end marker, WebP size matches), so a cut-off file or one with junk added after the end is refused. The real width and height are read from the header and limited (at least 16, at most 4000 pixels on a side) so a picture built to use up memory is refused. The picture is stored exactly as uploaded: nothing is decoded or re-drawn on the server.
- **Limits live in one place** (`images.config.ts`): 1 MB, 16 to 4000 pixels. The API sends them with every screen, so the web never has its own copy.
- **Size is stopped while the file is read**: a file over the limit never sits in memory in full, and is answered with the same plain reason `TOO_BIG`. The web server also refuses a body over 2 MB before reading it.
- **Pictures are shown only as pictures.** The answer has the picture's own type, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline` and `Content-Security-Policy: default-src 'none'; sandbox`; the web route passes on only the three picture types and never anything else. A picture address never serves other bytes, so browsers may cache it (`private, immutable`).
- **Who may look.** The logo: anyone signed in to the hospital (it prints on every receipt). A signature: its own doctor, and people who may read visits or doctors. Everyone else, another hospital, a switched-off person and any junk id get `404`.
- **Who may change.** The logo: a hospital-wide Admin only (it is the same for every branch). A signature: the doctor, or an Admin whose scope reaches the doctor (the same rule as the doctor profile).
- **A completed prescription keeps its signature.** The database copies the id of the doctor's current signature into the note's copy at completion, so a new picture later never changes an old prescription. A prescription completed before 7e prints no signature picture. The logo is not frozen: it is the hospital's current logo at the time of printing.
- **The signature box prints on pre-printed stationery too** (it is the doctor's, not part of the letterhead); the logo never does.
- **Storage.** The bytes go to the existing storage service (local folder under `STORAGE_ROOT_PATH`, one folder per hospital, key `images/<random id>`). The key is made by the server. If saving the row fails after the file is written, the file is removed again.
- **Audit** (`IMAGE_CHANGE`): who, which place (`HOSPITAL_LOGO` or `DOCTOR_SIGNATURE`) and `replace` or `remove`; never the picture, its key or its hash.
- **Web.** The picture box stays small (it does not make the page long); a refused file shows the reason in plain words with the real numbers from the limits; the chooser offers only picture files and the screen also checks type, size and emptiness before sending (a courtesy; the API checks again). The empty status line of the box is not drawn, so other screens keep their single status line.

## Adversarial self-review (review gate: tenant isolation, permissions, files)

| Attack or failure                                                              | Covered by                                                                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Script in the picture (SVG, HTML renamed `.png`, markup after the image end)   | Sniff tests and API tests: refused; served with `nosniff` and a sandbox policy                    |
| A cut-off or padded file, a decompression bomb, an empty or huge file          | Sniff tests; API tests (`CORRUPT`, `TOO_LARGE_PIXELS`, `TOO_BIG`, a 3 MB file stopped while read) |
| Another hospital reads or replaces a picture                                   | API tests (`404` both ways), RLS sample row, the doctor foreign key is per hospital               |
| One doctor uploads for another, or an id in the form picks the doctor          | API tests: the own route ignores the form; a Branch Admin outside the branch gets `404`           |
| A person without the permission uploads or removes                             | API tests (`403` on every route for four different roles); a one-branch Admin cannot set the logo |
| Path tricks in the id (`../`, `%00`, 300 characters)                           | API and web route tests: `404`, never a file path; the web encodes the id                         |
| Two uploads at once, or a failed save leaving a file behind                    | API test: exactly one current picture, every row has its file                                     |
| Editing or deleting a stored picture, two current pictures, wrong type/purpose | Database tests: the trigger and the indexes refuse                                                |
| A switched-off person fetching pictures with an old token                      | API test (`404`)                                                                                  |
| A new signature rewriting an old prescription                                  | API test: the note keeps the picture it was completed with; the print page uses that id           |
| Stale tab, another origin, JSON instead of a file, extra form fields           | Web route tests (`409`, `403`, `415`, `400`); API test for extra fields and a second file         |
| The access token reaching the browser through the picture route                | Web route test: no token in any header of the answer                                              |

Not covered by automatic tests: a real browser upload with a big photo (tested with fake files); the Postman collection (written, not run by me); an upload that is cut off in the middle by the network (the file is only stored after it is complete). **Verdict: safe to approve.** No decision is needed from Rakshith.

## Not done (follow-ups)

- Pictures are never deleted, so the history of a place can grow without limit. Only people with the permission can add to it (a hospital-wide Admin, a doctor, an Admin in scope). A limit or a clean-up job for old unused pictures is a later step.
- A file written just before a crash (before its row is saved) stays as an orphan in the storage folder. A clean-up job could find them.
- No server-side resize or format change: a 1 MB logo prints as it is. A later step may add it (the NestJS 12 upgrade 8a comes first).
- No editing or cropping on screen; a person prepares the picture first.
- The patient portal and HQ screens have no pictures.
- The print designer shows a marker for picture boxes, not the picture itself (the preview and printing show it).
- The Postman collection `hospigo-7e-pictures` sends a 30-byte WebP written as text in the body; if Postman changes the bytes on your machine, request 15 fails, and the same upload is proven by the automatic API test.
