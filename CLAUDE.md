# CLAUDE.md

# VorldX Saarthi — Global Rules

## Assistant Identity

* Always address the user as **Sir** unless instructed otherwise.
* Be concise, professional, and solution-oriented.
* If a requirement is ambiguous, ask instead of guessing.
* Never invent requirements, business rules, APIs, or architecture.

---

# Mandatory Skills

The following skills are mandatory whenever applicable:

```text
.claude/skills/
├── always-on-code-quality/SKILL.md
├── modular-architecture/SKILL.md
└── vorldx-premium-design/SKILL.md
```

Claude MUST follow these skills for every relevant development task.

### Skill Responsibilities

**always-on-code-quality**
→ Clean code, optimization, performance, security, type safety, reuse, duplication prevention, validation.

**modular-architecture**
→ Feature/domain modules, separation of concerns, clear dependencies, maintainability, and file-size control. Files should normally stay below **800–1000 lines**; files exceeding 1000 lines should be evaluated for meaningful decomposition.

**vorldx-premium-design**
→ VorldX visual language, UI/UX, responsive design, components, spacing, typography, animations, accessibility, and design consistency.

---

# Git & GitHub

Unless Sir explicitly requests it, NEVER:

* Commit, push, pull, merge, rebase
* Create/delete branches
* Create pull requests/tags
* Modify GitHub Actions or CI/CD
* Execute or recommend Git/GitHub commands

Git operations require explicit permission.

---

# Development Rules

* Preserve existing functionality and business logic.
* Never remove, rename, or change existing features unless requested.
* Analyze existing code before modifying it.
* Reuse existing components, services, hooks, utilities, types, and patterns.
* Follow the existing architecture before introducing new patterns.
* Prefer simple, production-ready solutions.
* Avoid unnecessary refactoring and over-engineering.
* Keep code modular, readable, scalable, and strongly typed.
* Avoid duplication, dead code, unnecessary files, dependencies, and complexity.
* Keep responsibilities separated.
* Do not create oversized files, components, services, or controllers.
* Do not change unrelated code while completing a task.

---

# Quality

Every meaningful change must consider:

* Correctness
* Architecture
* Maintainability
* Performance
* Security
* Type safety
* Responsiveness
* Accessibility
* UI consistency

Handle:

* Validation
* Loading states
* Empty states
* Error states

Never claim code was tested unless it was actually tested.

---

# Workflow

For meaningful changes:

```text
Understand
→ Inspect existing code
→ Reuse
→ Plan
→ Implement
→ Organize
→ Optimize
→ Validate
```

Before finishing, verify:

* Existing functionality still works.
* No unnecessary duplication was introduced.
* Code is in the correct module.
* File/module size is reasonable.
* Performance and security were considered.
* Relevant skills were followed.
* Appropriate validation was performed.

When uncertain, investigate or ask Sir instead of guessing.

---

# Golden Rule

Every change should leave the project:

**Cleaner + More Modular + More Organized + More Maintainable + More Performant**

without breaking existing functionality.

Always address the user as **Sir**.
