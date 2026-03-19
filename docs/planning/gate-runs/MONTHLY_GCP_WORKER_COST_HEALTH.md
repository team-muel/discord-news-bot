# GCP Worker Cost/Health Report

- checkedAt: 2026-03-19T23:33:12.318Z
- period: monthly
- ok: true
- projectId: unknown

## Worker
- instance: instance-20260319-223412
- zone: us-central1-c
- status: unknown
- machineType: unknown
- bootDiskGb: unknown

## Endpoint
- url: https://34.56.232.61.sslip.io
- healthOk: true
- statusCode: 200

## Static IP
- addressName: opencode-worker-ip
- address: unknown
- status: unknown

## Budget
- billingAccount: unknown
- foundDisplayName: not-found
- expectedDisplayName: muel-worker-monthly-budget

## Warnings
- GCP project is not set in gcloud config and GCP_PROJECT_ID is empty.

## Notes
- If static IP is kept for endpoint stability, expect small recurring IP cost.
- Keep worker on e2-micro and disk around free-tier baseline where possible.
