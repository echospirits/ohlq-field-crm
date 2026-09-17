# Agency store context

Agency accounts expose a compact store summary above the workspace navigation and one **Retail Intelligence** disclosure at the bottom of the account page, open by default. Its reading order is next actions and current inventory, retail market and product-fit evidence, then store and neighborhood context. Quiet headings and dividers replace separate top-level intelligence dropdowns. Product evidence, wholesale influence, and store editing remain secondary disclosures. Market and fit evidence share two columns on wide screens and stack on phones. Existing store/market anchor links reveal the parent panel if it has been closed. Linked wholesale opportunity intelligence remains separate.

Store context is a versioned JSON document in `OrganizationAccountOverlay.storeContext`, scoped by organization, account type, and internal Agency ID. It records ownership and chain, store format, buying authority, neighborhood and nearby business mix, and optional area demographics. Each section carries its source and observation date. Sources older than six months are flagged for review. Unknown values remain explicit; names and addresses are not used to guess ownership or customer demographics.

An authenticated non-Taster user in an organization with Agency Intelligence enabled can edit the profile in place. The API validates all enums, dates, URLs, numeric ranges, and provenance; ignores client-supplied audit metadata; and checks the saved version and overlay timestamp before writing. A failed save retains form values. Other overlay fields, including notes, are preserved.

Demographics require geography, data year, source name, HTTP(S) URL, and observation date. These are area measurements, not claims about store shoppers. This release supports sourced team entry; it does not initiate automatic paid research or infer missing context.

Retail market and product-fit records are loaded for the current organization only. Category mix excludes the tenant portfolio; volume uses 750ml equivalents. Coverage, source date, low confidence, and stale data are displayed. The exploratory product-fit scores are not conversion probabilities; insufficient-data scores are withheld. Store context does not yet alter scoring or the live Agency Focus queue.

The additive migration adds one nullable JSONB column and is transaction-wrapped. Apply before deploying the application query that reads it.
