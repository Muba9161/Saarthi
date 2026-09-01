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

// Deliberately standalone: this is a Gradle build sitting inside an npm
// workspace, and it must not be pulled into either tool's graph. npm's `apps/*`
// glob only matches directories containing a package.json, so `npm install`
// skips this one; Gradle in turn knows nothing about the TypeScript around it.
rootProject.name = "saarthi-device"
include(":app")
