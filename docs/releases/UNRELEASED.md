# Unreleased

Version **0.6.0** is the frozen Production Forecasting release candidate, explicitly authorized for main on November 3, 2026. Production remains **0.5.2** until deployment and target verification are complete. No new development version or feature cycle is opened.

- [0.6.0 release notes and technical manifest](0.6.0.md)
- [0.6.0 candidate checklist](0.6.0-checklist.md)
- [0.6.0 validation](0.6.0-validation.md)
- [Source-line exclusion validation](production-invoice-exclusion-validation.md)
- [0.5.2 release notes and validation](0.5.2.md)

## Changes

The authorized forecasting contents are archived in [0.6.0](0.6.0.md) for this frozen candidate: cumulative 30/60/90-day views, coherent daily forecasts with horizon-specific evidence, and the owner-approved exact invoice exclusion. Candidate and deployment gates remain pending in the checklist until checked against the final commit.

No unrelated TST maintenance is included. Test pruning, `test:focus`, scratch TypeScript exclusions and test/developer-documentation changes remain TST-only. The production candidate retains main's existing coverage and tooling.

## Entry template

- Description and user-visible behavior:
- Relevant TST commit(s):
- Validation and known limits:
- Migration, backfill, environment/configuration and feature flags:
- Release/recovery notes:
