-- A family member may now be named by email address as well as by mobile number.
ALTER TABLE "ride_share_viewers" RENAME COLUMN "phone" TO "contact";
