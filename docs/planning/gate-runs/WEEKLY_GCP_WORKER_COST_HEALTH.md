# GCP Worker Cost/Health Report

- checkedAt: 2026-04-19T07:46:31.491Z
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
- healthOk: false
- statusCode: 0

## Always-On Services

- implementWorker: ok=false status=0 checkedUrl=<http://34.56.232.61:8787>
- architectWorker: ok=false status=0 checkedUrl=<http://34.56.232.61:8791>
- reviewWorker: ok=false status=0 checkedUrl=<http://34.56.232.61:8792>
- operateWorker: ok=false status=0 checkedUrl=<http://34.56.232.61:8793>
- openjarvisServe: ok=false status=0 checkedUrl=<http://34.56.232.61:8000>
- unifiedMcp: ok=true status=200 checkedUrl=<https://34.56.232.61.sslip.io/mcp/health>

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

- Always-on service 'implementWorker' health probe failed.
- Always-on service 'architectWorker' health probe failed.
- Always-on service 'reviewWorker' health probe failed.
- Always-on service 'operateWorker' health probe failed.
- Always-on service 'openjarvisServe' health probe failed.
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
