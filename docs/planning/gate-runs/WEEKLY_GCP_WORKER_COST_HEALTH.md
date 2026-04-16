# GCP Worker Cost/Health Report

- checkedAt: 2026-04-16T19:38:04.897Z
- period: weekly
- ok: false
- projectId: gen-lang-client-0405212361

## Worker

- instance: instance-20260319-223412
- zone: us-central1-c
- status: unknown
- machineType: unknown
- bootDiskGb: unknown

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
- address: unknown
- status: unknown

## Budget

- billingAccount: unknown
- foundDisplayName: not-found
- expectedDisplayName: muel-worker-monthly-budget

## GCP-Native Hardening

- ingressMode: temporary-sslip
- customDomainConfigured: false
- automaticRestart: unknown
- osLoginEnabled: unknown
- shieldedVm: secureBoot=unknown vTpm=unknown integrityMonitoring=unknown
- bootDiskSnapshotPolicies: none
- serviceAccount: unknown dedicated=unknown cloudPlatformScope=unknown

## Failures

- Failed to read worker instance metadata: ERROR: (gcloud.compute.instances.describe) You do not currently have an active account selected.
Please run:

  $ gcloud auth login

to obtain new credentials.

If you have already logged in with a different account, run:

  $ gcloud config set account ACCOUNT

to select an already authenticated account to use.

## Warnings

- Worker ingress still uses sslip.io; move to a custom domain before broader rollout.
- Unable to inspect static IP status: ERROR: (gcloud.compute.addresses.list) You do not currently have an active account selected. | Please run:
- Unable to list billing accounts: ERROR: (gcloud.billing.accounts.list) You do not currently have an active account selected. | Please run:

## Notes

- Baseline manifest: /home/runner/work/discord-news-bot/discord-news-bot/config/runtime/operating-baseline.json
- If static IP is kept for endpoint stability, expect small recurring IP cost.
- Worker baseline is e2-medium (4GB). Keep disk around 30GB where possible.
- Treat custom domain, snapshot schedule, OS Login, Shielded VM, and least-privilege service accounts as the current GCP hardening backlog on this worker lane.
