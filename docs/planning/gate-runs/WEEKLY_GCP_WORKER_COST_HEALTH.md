# GCP Worker Cost/Health Report

- checkedAt: 2026-03-19T23:35:54.078Z
- period: weekly
- ok: true
- projectId: gen-lang-client-0405212361

## Worker
- instance: instance-20260319-223412
- zone: us-central1-c
- status: RUNNING
- machineType: e2-small
- bootDiskGb: 30

## Endpoint
- url: https://34.56.232.61.sslip.io
- healthOk: true
- statusCode: 200

## Static IP
- addressName: opencode-worker-ip
- address: 34.56.232.61
- status: IN_USE

## Budget
- billingAccount: 0128DB-0D1E45-996490
- foundDisplayName: not-found
- expectedDisplayName: muel-worker-monthly-budget

## Warnings
- Static external IP is IN_USE; this improves stability but may incur small recurring cost.
- Unable to list budgets via gcloud beta: ERROR: (gcloud.beta.billing.budgets.list) [fancy2794@gmail.com] does not have permission to access billingAccounts instance [0128DB-0D1E45-996490] (or it may not exist): Your application is authenticating by using local Application Default Credentials. The billingbudgets.googleapis.com API requires a quota project, which is not set by default. To learn how to set your quota project, see https://cloud.google.com/docs/authentication/adc-troubleshooting/user-creds . This command is authenticated as fancy2794@gmail.com which is the active account specified by the [core/account] property. | Your application is authenticating by using local Application Default Credentials. The billingbudgets.googleapis.com API requires a quota project, which is not set by default. To learn how to set your quota project, see https://cloud.google.com/docs/authentication/adc-troubleshooting/user-creds .

## Notes
- If static IP is kept for endpoint stability, expect small recurring IP cost.
- Worker runs on e2-small (2GB). Keep disk around 30GB baseline where possible.
