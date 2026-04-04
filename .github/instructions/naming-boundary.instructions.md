---
description: "Internal naming boundary — separates repository-local role labels from external OSS framework names. Load when encountering tool names or role references."
applyTo: "docs/**"
---

# Internal Naming Boundary

- Internal role names (Implement, Architect, Review, Operate) are repository-local collaboration labels describing function.
- They do not imply that similarly named external OSS frameworks are installed or directly executed.
- External OSS tool names (NVIDIA NemoClaw, Stanford OpenJarvis, NVIDIA OpenShell, OpenClaw) are separate and used only via external adapters.
- Canonical naming: `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`, `docs/ROLE_RENAME_MAP.md`.
