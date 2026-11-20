-- Sign-in emails used to carry the code in the subject line, and subjects are kept in
-- the delivery log that administrators read. The code now goes in the body only (which
-- the log has always withheld); this removes the codes already stored.
UPDATE "message_log" SET "subject" = 'Your Track Day sign-in code' WHERE "kind" = 'signin';
