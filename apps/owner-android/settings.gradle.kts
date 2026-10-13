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

// Saarthi for owners and businesses — its own build.
//
// Standalone like `apps/device-android` and `apps/terminal-android`: npm's
// workspace glob skips a folder with no package.json, and this build knows
// nothing of the TypeScript around it. Kept apart from the terminal build so a
// release of the fitted terminal or the driver app never waits on this one, and
// a change here can never reach them.
rootProject.name = "saarthi-owner-android"
include(":app")
