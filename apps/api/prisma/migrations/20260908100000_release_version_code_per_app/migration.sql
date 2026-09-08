-- A release's version code is unique per app, not across all of Saarthi.
--
-- The terminal app and the driver app are separate packages with independent
-- version numbers, and both start at 1. A global unique constraint made the
-- second app's first release impossible to upload.

DROP INDEX "terminal_releases_versionCode_key";
DROP INDEX "terminal_releases_status_versionCode_idx";

CREATE UNIQUE INDEX "terminal_releases_applicationId_versionCode_key"
    ON "terminal_releases" ("applicationId", "versionCode");

-- The update check always asks "newest published build of *this* app", so the
-- application id leads the index.
CREATE INDEX "terminal_releases_applicationId_status_versionCode_idx"
    ON "terminal_releases" ("applicationId", "status", "versionCode");
