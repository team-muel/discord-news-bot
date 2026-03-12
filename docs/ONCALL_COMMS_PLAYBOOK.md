# On-Call Communications Playbook

Use this playbook to keep communications fast, consistent, and low-noise during incidents.

## 1) Channel Rules

- Internal ops channel: real-time triage and decisions
- Executive/stakeholder channel: concise status snapshots
- Public/user channel: impact-focused updates only

## 2) Update Cadence

- SEV-1: every 15 minutes
- SEV-2: every 30 minutes
- SEV-3: at start, major changes, and resolution

## 3) Message Format

Each update should include:

- Current status
- User impact
- What changed since last update
- Next action and ETA

## 4) Ready-to-Use Message Templates

### 4.1 Initial Acknowledgement

We are investigating an issue affecting Muel platform services.
Current impact: <impact>.
Scope: <components>.
Next update in <15/30> minutes.

### 4.2 Mitigation In Progress

Mitigation is in progress.
Current impact: <impact>.
Latest action: <action>.
Validation status: <pass/fail/in-progress>.
Next update in <15/30> minutes.

### 4.3 Recovery Confirmed

Service has recovered and is currently stable.
Impact window: <start> to <end>.
We are monitoring closely and will share final closure after validation.

### 4.4 Final Closure

Incident resolved.
Root cause (preliminary): <summary>.
Permanent fixes and prevention work will be tracked in postmortem.

## 5) Escalation Triggers

Escalate immediately when:

- SEV-1 not mitigated within 30 minutes
- Data integrity risk is detected
- Auth/session failures are broad and persistent
- Multiple platform components fail simultaneously

## 6) Quality Checklist for Every Update

- Is the message accurate and current?
- Does it avoid speculation?
- Does it include ETA or next checkpoint?
- Is ownership clear?
