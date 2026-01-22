# Roadmap and Principles

Status is tracked in TASKS.md only. This document is the reference for scope and sequencing.

## Definition of Done (MVP)
- TenantOrganization created via Dev Auth (dev headers only when enabled)
- AI triage creates Customer, PropertyAddress, ServiceCategory, Job (tenant-scoped)
- Conversation visible with CommunicationEvent/Content (SMS, WEB, VOICE)
- Job visible with correct status, urgency, tenant isolation
- Stripe payment succeeds before job confirmation
- SMS/email/voice confirmation sent only after payment success
- Voice/SMS consent language enforced before interaction
- End-to-end smoke test passes (AI -> payment -> job -> SMS/VOICE)
- Multi-tenant isolation enforced on all reads/writes
- External providers disabled by default in dev

## Sprint Plan

### Sprint 1 - Security Foundations
- Tasks: T-01
- Exit: Cross-tenant access impossible

### Sprint 2 - AI Reliability and Job Integrity
- Tasks: T-02, T-02.5, T-02.6, T-03
- Exit: AI safely triages via text or voice with voice-grade data integrity guarantees

### Sprint 3 - Revenue Lock-In
- Tasks: T-04, T-05, T-08
- Exit: No unpaid job can exist

### Sprint 4 - MVP Polish and Demo Readiness
- Tasks: T-06, T-07, T-09
- Exit: Demo-ready MVP

## Global Principle
If a task is not in the Canonical Task Board, it does not exist.
