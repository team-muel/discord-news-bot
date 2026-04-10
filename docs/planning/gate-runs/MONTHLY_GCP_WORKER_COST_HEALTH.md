# GCP Worker Cost/Health Report

- checkedAt: 2026-04-09T18:44:33.177Z
- period: monthly
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
- unifiedMcp: ok=true status=200 checkedUrl=<https://34.56.232.61.sslip.io/obsidian/health>
- litellmProxy: ok=true status=200 checkedUrl=<https://muel-litellm-proxy.onrender.com/health/liveliness>

## Static IP

- addressName: opencode-worker-ip
- address: 34.56.232.61
- status: IN_USE

## Budget

- billingAccount: 0128DB-0D1E45-996490
- foundDisplayName: muel-worker-monthly-budget
- expectedDisplayName: muel-worker-monthly-budget

## Warnings

- Static external IP is IN_USE; this improves stability but may incur small recurring cost.

## Notes

- Baseline manifest: C:\Muel_S\discord-news-bot\config\runtime\operating-baseline.json
- If static IP is kept for endpoint stability, expect small recurring IP cost.
- Worker baseline is e2-medium (4GB). Keep disk around 30GB where possible.
