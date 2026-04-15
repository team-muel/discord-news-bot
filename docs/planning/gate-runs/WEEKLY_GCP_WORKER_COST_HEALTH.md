# GCP Worker Cost/Health Report

- checkedAt: 2026-04-13T14:27:18.462Z
- period: weekly
- ok: true
- projectId: gen-lang-client-0405212361

## Worker

- instance: instance-20260319-223412
- zone: us-central1-c
- status: RUNNING
- machineType: e2-medium
- bootDiskGb: 30

## Endpoint

- url: <https://34.56.232.61.sslip.io>
- healthOk: true
- statusCode: 200

## Always-On Services

- implementWorker: ok=true status=200 checkedUrl=<https://34.56.232.61.sslip.io/health>
- architectWorker: ok=true status=200 checkedUrl=<https://34.56.232.61.sslip.io/architect/health>
- reviewWorker: ok=true status=200 checkedUrl=<https://34.56.232.61.sslip.io/review/health>
- operateWorker: ok=true status=200 checkedUrl=<https://34.56.232.61.sslip.io/operate/health>
- openjarvisServe: ok=true status=200 checkedUrl=<https://34.56.232.61.sslip.io/openjarvis/health>
- unifiedMcp: ok=true status=200 checkedUrl=<https://34.56.232.61.sslip.io/mcp/health>
- litellmProxy: ok=true status=200 checkedUrl=<https://muel-litellm-proxy.onrender.com/health/liveliness>

## Static IP

- addressName: opencode-worker-ip
- address: 34.56.232.61
- status: IN_USE

## Budget

- billingAccount: 0128DB-0D1E45-996490
- foundDisplayName: muel-worker-monthly-budget
- expectedDisplayName: muel-worker-monthly-budget

## GCP-Native Hardening

- ingressMode: temporary-sslip
- customDomainConfigured: false
- automaticRestart: false
- osLoginEnabled: unknown
- shieldedVm: secureBoot=false vTpm=true integrityMonitoring=true
- bootDiskSnapshotPolicies: default-schedule-1
- serviceAccount: `354791569888-compute@developer.gserviceaccount.com` dedicated=false cloudPlatformScope=false

## Warnings

- Worker ingress still uses sslip.io; move to a custom domain before broader rollout.
- Compute Engine automaticRestart is disabled; unexpected maintenance can leave the worker offline.
- OS Login is not explicitly enabled for the worker; prefer IAM-backed SSH over per-box account drift.
- Shielded VM protections are not fully enabled; review secure boot, vTPM, and integrity monitoring.
- Worker still uses the default Compute Engine service account; switch to a dedicated least-privilege service account.
- Static external IP is IN_USE; this improves stability but may incur small recurring cost.

## Notes

- Baseline manifest: C:\Muel_S\discord-news-bot\config\runtime\operating-baseline.json
- If static IP is kept for endpoint stability, expect small recurring IP cost.
- Worker baseline is e2-medium (4GB). Keep disk around 30GB where possible.
- Treat custom domain, snapshot schedule, OS Login, Shielded VM, and least-privilege service accounts as the current GCP hardening backlog on this worker lane.
