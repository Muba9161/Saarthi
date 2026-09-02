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
rootProject.name = "saarthi-terminal"
include(":app")
