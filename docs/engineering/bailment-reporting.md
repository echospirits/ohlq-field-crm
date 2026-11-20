# Direct Bailment reporting

The native Bailment PO and Invoice download can publish typed invoice-line data for a direct Looker Studio PostgreSQL connection. The reporting data is separate from Production Forecasting's normalized demand inputs. The existing production source job supplies both consumers from the same native download; this feature adds no scheduler, download button, application route or provider account.

The published production release is [**0.11.0**](https://github.com/echospirits/ohlq-field-crm/releases/tag/v0.11.0), with the exact migration, restricted reporting login and first native acquisition verified. The original dashboard's production source, financial values, periods, explicit filters, saved-viewer reload and desktop layouts pass acceptance. Mobile viewport acceptance was unavailable in the connected desktop browser and is not claimed. See the [release checklist](../releases/0.11.0-checklist.md) and [validation record](../releases/0.11.0-validation.md).

## Source and publication

`lib/ohlqBailmentReportingParser.ts` validates the complete native 21-column CSV. Dates are date-only values, amounts and quantities use exact `Decimal(24,6)`, and identifiers stay text. Every original source cell is retained in `sourceValues`. Blank, zero, negative and duplicate lines remain distinct. Malformed data, incompatible headers, invalid values and oversized exports fail closed.

The downloader supplies the report identity, requested dates, resolved all-values Vendor or Brand scope, actual request/acquisition timestamps, byte length and completed-export evidence. `lib/ohlqBailmentReporting.ts` rechecks the active Ohio organization, its timezone and configured history start, then publishes a complete snapshot in one tenant-locked transaction. Forecasting date clipping, product rules and direct-invoice normalization occur after financial publication and do not remove financial reporting lines.

A failed publication leaves the last successful snapshot available. Reporting and forecasting outcomes are independent, so a finance-only correction can refresh reporting and a later forecast failure does not roll it back. Repeating the same request is idempotent; conflicting evidence for that request fails. Older requests cannot replace newer ones. Newer unchanged content updates source acquisition metadata without duplicating lines. Retention keeps the current complete report and one prior distinct report. A continuity check rejects substantial loss of established history, but cannot prove the upstream export contains every expected transaction.

## Database and view

The additive migration is `20261119010000_bailment_reporting`, SHA-256 `a513d0691e3cd34c99228038eea15b5561ead67e84a1b4d25e98a3db3d2e290a`. It adds `OhlqBailmentReportingSnapshot`, `OhlqBailmentReportingLine` and `public.echo_bailment_reporting`, with no change to prior application tables. Rehearse this exact SQL on a production-derived branch before applying it to the independently verified production target. Record the exact checksum in the migration ledger. Do not apply unrelated pending migrations or use TST-only retained-archive bootstrap tools; production starts with a new native source acquisition.

The security-barrier view is fixed to active, nonsuspended Echo organization `org_echo_spirits` with Ohio enabled. It exposes only that organization's latest complete snapshot. The first 21 fields preserve the native column names:

```
Vendor_Name, Broker_Name, Invoice_Date, Invoice_Number, PO_Create_Date,
PO_Number, Transfer_Order_Number, Agency, Transfer_Order_Ship_Date,
UPC_Code, Brand, Name, Category, DC_Name, Cases, Odd_Bottles,
Cases_Bottles, Quoted_Case_Price, Discount, Total, Date_Paid
```

Four provenance fields follow: `Report_Retrieved_At`, `Report_From`, `Report_To` and `Source_Row_Number`. `Report_Retrieved_At` is the actual acquisition time converted to the source timezone, not the migration time or the dashboard cache-refresh time. A source row is an invoice line; counting rows does not count distinct invoices, orders or agencies. `Cases_Bottles` remains source text. `Total` is the native invoice line amount.

## Access and dashboard behavior

Provision the dedicated reporting login separately from the application. It needs database `CONNECT`, schema `USAGE` and `SELECT` only on `public.echo_bailment_reporting`. Grant no application or Neon administrative role membership, no base-table reads and no writes. Verify effective privileges and actual connection behavior using that login: the view succeeds, private application relations are denied, and mutations are denied. Keep passwords, connection strings and financial source data out of commits and logs.

Use Looker Studio's PostgreSQL connector with SSL and the independently verified production endpoint, database and restricted login. Preserve date, text-identifier and amount types. The existing dashboard keeps its report identity and other spreadsheet-backed sources. Bailment financial charts retain `SUM(Total)` and `Invoice_Date`; the existing business exclusions for `3150B`, `3750B` and the original blank-brand clause must be applied to the Neon source because the native reporting view retains the full source. Do not rebind an unrelated shared spreadsheet filter to the Neon source.

In the accepted production report, attach the shared Neon Bailment exclusion filter explicitly to **every Bailment chart**, including both source-time cards. Its saved clauses are **Exclude 3150B AND Exclude 3750B AND Exclude blank**. Inherited-filter state did not persist reliably in the editor, so the redundant Sales Stats page filter was removed and the per-chart bindings were verified. Keep the original monthly-source filters unchanged.

The Sales Stats additions use native **week to date, Monday, include today** and **last week, Monday** presets. The prior complete week is Monday–Sunday. Existing rolling comparisons retain Monday-start week offsets **6 through 1**, **12 through 7** and **58 through 53**; preserve the existing quarter/month/year calculations as well. Core Revenue and Sales Stats each show the actual Bailment source acquisition time in Eastern time. A dashboard cache refresh alone does not retrieve a new source report.

## Daily outcome and operational acceptance

Production retains its existing daily source scheduling and shared provider concurrency policy. The daily persisted-data verification must require a current complete reporting snapshot for the enrolled reporting scope, as well as the existing forecast/DC requirements. A forecasting import alone cannot prove the financial snapshot is current. The scoped 0.11.0 integration includes a reporting-readiness check; its exact behavioral evidence is recorded separately from earlier TST publisher acceptance.

Production acceptance requires a successful native production acquisition followed by independent database readback and the restricted reporting login, then reconciliation of the existing dashboard's financial charts, week boundaries, filters and source-time cards. Verify the original report URL and unrelated source bindings after publication. If any live step is pending, record it as pending rather than inferring success from a migration, build, retained source or successful forecast import.

The first production native acquisition and targeted reporting-readiness check pass. This was a focused source run; the full normal daily persisted-data verifier was skipped by that mode. Its broader execution is not inferred from the focused receipt. Existing production daily scheduling and disabled TST daily scheduling remain unchanged.

Rollback may restore the prior application while retaining these additive reporting objects and the last good snapshot. Reverting a dashboard connection is a separate operation. Do not delete production source history or change another tenant's data to roll back this feature.
