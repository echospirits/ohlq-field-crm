# Production source download repair

Owner requested repairing automated Bailment PO/Invoice and Partner DC downloads on October 28, 2026. The fix was developed and live-tested in TST 0.5.0-dev, then selectively released under separate owner authorization as production 0.4.2. The unrelated 0.5.0 interface remains in TST.

## Confirmed failures

- Owner confirmed both source URLs and that Bailment has `From` and `To` fields visible immediately. Its date fields differ from the shared sales reports' `From date` / `To date` labels.
- TST diagnostic commit `e4e35cec2a0b46600e6de81499191ae42136d6cf`, Actions run `40807721874`, found Vendor loaded but the expected old date controls absent; no render-error banner was detected.
- In that same real source check, Partner DC's visible loading shell reported zero rows. Its CSV completed one second later with all 33 rows and no parse errors. The premature expected count caused the rejection.

## Correction and acceptance

- Report-specific date labels and accessible-label lookup; calendar dates are verified by normalized date value after entry/selection.
- Partner DC readiness requires a positive unfiltered total and matching displayed rows. Full CSV count validation is unchanged, so pagination, filtering and truncation still fail safely.
- Four actual Chromium fixture checks cover initial zero count, delayed tbody redraw, filtered/empty sources, truncated exports, and the distinct Bailment/shared-report date controls.
- Final full suite: 887 passed (75 suites, no failures/skips); focused browser/import/authentication suite: 19 passed. TypeScript and optimized build passed for the correction.
- TST hosted download validation is scoped to its repository/ref/environment, reads configuration and credentials inside a database-enforced read-only transaction, and then downloads/validates both sources without importing or refreshing. It shares the existing OHLQ concurrency lock. Private files are discarded and never uploaded.

## Live result

Corrected commit `93a160dc7f3ce458a09164c08b80f12c8a1dd80b` passed the actual hosted source step in [Actions run 40809092919](https://github.com/echospirits/neat-tst/actions/runs/40809092919). Both sources validated with zero database writes:

- Bailment: requested January 1, 2019 through October 28, 2026; 6,001 normalized complete-day demand rows, 247 excluded, 917 direct invoices; 15 current-day movements deferred. The live export includes 147 outside-portfolio rows.
- Partner DC: waited for total 33, exported all 33 without parse errors; 60 normalized guidance rows, 14 excluded, 3 outside-portfolio products.
- All four browser regressions passed in hosted Chromium. Local focused suite: 19 passed; typecheck and optimized build passed. TST Vercel deployment `dpl_E6JzjofVFM3EJDTdSvVFz9D4Ezkp` is READY at the corrected commit.

The TST run establishes working live downloads and native parsing without database writes. Subsequent production release `v0.4.2` (`5143a53a`) passed actual hosted downloads/imports and forecast refresh in [run 40811895336](https://github.com/echospirits/ohlq-field-crm/actions/runs/40811895336). Readback confirms 6,001 demand rows, 60 guidance rows, 19 numeric eligible forecasts, no duplicate demand identities and retained historical failures. See the [production receipt](0.4.2-validation.md). No migrations, credential/configuration changes or additional recurring schedule were introduced. Both branches retain identical downloader fixes; unrelated 0.5.0 UI changes were not promoted.
