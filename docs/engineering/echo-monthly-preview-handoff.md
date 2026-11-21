# Echo bottle-sales preview repair

Apply these changes to the [bottle-sales preview](https://datastudio.google.com/u/1/reporting/450b366c-ea69-4d8e-a6d9-f113d11ea513). In both reusable sources use Refresh fields and retain their existing SSL connections, IDs and calculated field IDs.

- [Sales source](https://datastudio.google.com/u/1/datasources/c39e0d9b-fab7-45c1-bf80-81e468b562c5) adds numeric `Current_YTD_Ready` and `Prior_YTD_Ready`. Apply the readiness guards in [the field manifest](echo-item-sales-looker-fields.json) to the existing calculated fields by ID before showing YTD or change metrics. Use a blank/unavailable display for null. Guard percent change with both flags and a nonzero prior denominator.
- Keep Monthly Bottle Sales and Channel Trends on `Month` with the existing signed retail/wholesale sums. Use a gap for omitted periods. Do not fill missing months from a date spine with zero.
- Add the three `reportingMonthMetrics` from the manifest to Product Performance and Agency Performance. Keep those charts on all available source dates so the matched-period fields can aggregate both periods. Scope page date controls to the Monthly and Channel charts. Keep the existing Product mapping.
- Apply the shared Brand exclusions for `3150B`, `3750B` and `4359B` to the four sales charts. No source facts are excluded.
- [Status source](https://datastudio.google.com/u/1/datasources/2382773d-98a1-4abf-bf1a-565579e720f8) adds both readiness flags, `Available_Months` and `Empty_Completed_Months`. Update Bottle data status by ID. A certified empty month contributes to availability even when the sales view has no rows for it. Use certified and expected day counts separately for overall progress.
- Verify in View mode with September totals and null YTD metrics. Check original production dashboard bindings and Bailment source inventory separately. The original dashboard cutover is outside this repair.
