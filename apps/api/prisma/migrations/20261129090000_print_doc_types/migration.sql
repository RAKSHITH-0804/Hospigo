-- Step 2.1a: two new print types. Prescription (slim, goes to the pharmacy) and Patient report (the
-- patient's copy, today's full print) are separate documents; the patient card is a label.
-- A new enum value cannot be used in the same transaction, so the data move is in the next migration.
ALTER TYPE "print_doc_type" ADD VALUE IF NOT EXISTS 'PATIENT_REPORT';
ALTER TYPE "print_doc_type" ADD VALUE IF NOT EXISTS 'PATIENT_CARD';
