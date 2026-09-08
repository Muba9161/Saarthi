pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

// Standalone, exactly like `apps/device-android`: a Gradle build living inside
// an npm workspace that must not be pulled into either tool's graph. npm's
// `apps/*` glob only matches directories containing a package.json, so
// `npm install` skips this one; Gradle in turn knows nothing about the
// TypeScript around it.
//
// Deliberately a *separate* build from the device app rather than a second
// module in it. The two are different products with different release
// cadences — one is a developer's test harness, the other is fitted to a
// customer's vehicle — and a shared build would make every terminal release
// wait on the test app compiling.
/*
 * Three projects, not one.
 *
 * `:core` is the job — telemetry, map, cockpit, checklist, trips, updates — and
 * the two apps are the ways a person reaches it. A tablet is paired to a truck
 * by a fitter and identifies its driver on arrival; a phone is signed in to by
 * the driver, who then scans the truck. Everything after that point is the same
 * work, and it is written once.
 *
 * The alternative was a second copy of eighteen thousand lines, which would
 * have diverged at the first bug fixed in only one of them.
 */
rootProject.name = "saarthi-android"
include(":core")
include(":terminal")
include(":driver")

