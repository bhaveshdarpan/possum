# Tax Domain — Hexagonal Folder Structure Proposal

## Context

The earlier audit identified two structural gaps in the tax code:

1. **No declared port.** Every other domain has a base class in
   [core/plugin/handlers/](core/plugin/handlers/) (e.g.
   [base_customer_exporter.py](core/plugin/handlers/base_customer_exporter.py),
   `base_invoice_exporter.py`, `base_payment_exporter.py`). A
   `BaseTaxHandler` is missing — so tax plugins are enforced only by
   duck typing on `app/tax/service.py` call sites.
2. **No shared domain layer above plugins.** `TaxDocument`, `TaxQuote`,
   `Address`, exemption policy, rounding etc. currently live **inside**
   [connectors/avalara/domain/](connectors/avalara/domain/) and
   [connectors/avalara/policies/](connectors/avalara/policies/). A
   second tax plugin (Anrok) would either duplicate them or reach
   sideways into the Avalara package.

Goal: restructure the tax domain so it is properly hexagonal —
**ports + shared domain + plugin-as-adapter** — without touching any
other domain (customers, invoices, payments all keep their existing
`schema.py + service.py` layout and their existing
`Base*Exporter(ABC)` handlers).

This proposal is design-only. Implementation happens in a follow-up.

## Current state (2026-05-09)

Re-baselined against `main`. Waves 1–2 of the H-series are merged;
wave 3 (H3b + H3c) is in review. **A second port — `TaxRateCatalogPort`
(#880) — has been added to the tax domain to cover ERP tax-rate-catalog
adapters**, separate from `BaseTaxHandler`. H2a was rejected and dropped.

### H-series — actual progress

| Plan PR  | GitHub PR                                                     | Title                                                                                  | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H2a      | [#864](https://github.com/zenskar/connector-service/pull/864) | feat(tax): scaffold core/domains/tax primitives                                        | ❌ CLOSED — rejected as speculative scaffolding; the rounding / currency-normalization policies had no production callers (only their own tests).                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| H2b      | [#865](https://github.com/zenskar/connector-service/pull/865) | refactor(tax): hoist domain to core/domains/tax + migrate imports (H2b)                | ✅ MERGED `ba31eca8` (2026-05-06) — broader scope than originally planned: hoist + migrate ~40 caller import paths + delete `connectors/avalara/domain/` (no shims)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| H2c      | [#867](https://github.com/zenskar/connector-service/pull/867) | refactor(tax): rename AVALARA*\*wire codes to TAX*\* and neutralize messages (H2c)     | ✅ MERGED `e783450d` (2026-05-06) — split out from H2b for revertability; downstream-consumer audit (frontend + backend) cleared the rename                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| H1       | [#868](https://github.com/zenskar/connector-service/pull/868) | feat(tax): BaseTaxHandler port + Avalara additive conformance (H1)                     | ✅ MERGED `0dccc4c3` (2026-05-06) — port at `core/plugin/handlers/base_tax_handler.py` with 3 abstract methods (`estimate_tax`, `create_tax`, `report_credit_note`); Avalara conforms additively                                                                                                                                                                                                                                                                                                                                                                                               |
| H3a      | [#869](https://github.com/zenskar/connector-service/pull/869) | feat(tax): app/tax/mappers.py for HTTP ↔ domain conversion (H3a)                       | ✅ MERGED `6a334055` (2026-05-07) — `app/tax/mappers.py` (327 lines) shipped as dead code with full unit test coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| H3b      | [#888](https://github.com/zenskar/connector-service/pull/888) | feat(tax): wire app/tax/service.py to BaseTaxHandler port (H3b)                        | 🟢 OPEN — wires `/tax/estimate` and single-parent `/tax/report_credit_note` through the port; **scope narrower than original plan**: 4 of 5 splat sites remain (the 5th, `/tax/estimate`, is migrated). See deviations / Suggested Work #0 for the largest residual (`/tax/create`). **2026-05-09 amend `bbd315f8`** folds in the report-credit-note schema fix surfaced by smoke (`credit_note_id: Optional[UUID] → str`, `invoice_id: Optional[UUID] → Optional[str]`); CI green. See deviation #12.                                                                                         |
| H3c      | [#890](https://github.com/zenskar/connector-service/pull/890) | chore(tax): cleanup after H3b — dead code, TaxPlugin, AdjustTransaction scaffold (H3c) | 🟢 OPEN — stacked on H3b; drops `Avalara.estimate_sales_tax` splat, removes `TaxPlugin` wrapper, retires `AdjustTransaction` scaffold (gateway op + schema + enum + tests). The `_single_parent_refund` → public-method refactor was absorbed into H3b (commit `592622a8`) as `CreditNoteService.refund_transaction(refund: Refund)`. **2026-05-09 added `bc81915a`** — `Refund.credit_note_id` pre-validator at the domain boundary so future construction sites (programmatic dispatch, port adapters, tests) can't re-introduce the H3b regression by handing in a UUID. See deviation #12. |
| **#880** | [#880](https://github.com/zenskar/connector-service/pull/880) | **feat(tax): TaxRateCatalogPort + ErpTaxCode for ERP tax-code adapters**               | 🟢 OPEN — **new architectural element not in original plan**. Adds a second driving port at `core/plugin/handlers/tax_rate_catalog_port.py` for ERP tax-rate-catalog operations (`list_tax_rates` / `get_tax_rate_by_id` / `create_tax_rate`); adds `ErpTaxCode` value object. Independent of `BaseTaxHandler`. Parallel to H3b.                                                                                                                                                                                                                                                               |
| H4       | —                                                             | Anrok adapter implementing BaseTaxHandler                                              | ⏳ deferred — out of scope for this plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### S-series — bounded-context tightening (post-H3 follow-ups)

Stacked on the H3b/H3c wave. Closes the typed-error contract that R2 started (only `CurrencyConversionError` got wired; the rest were defined but never raised), and finishes the tax bounded context by lifting country tax configs into `core/domains/tax/`, renaming the AVALARA\_\*-prefixed domain errors raised by country configs, and typing the country-config seam end-to-end.

**The S-series originally landed as #892 → #893 → #894 (each one alternated cleanup ↔ refactor ↔ cleanup-then-refactor, which made review path-dependent and slow). Reorganized 2026-05-09 into three single-purpose PRs by commit type so reviewers can decide review depth per-PR upfront** — see deviation #11.

| Plan PR      | GitHub PR                                                         | Title                                                                                                | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-bugfix     | [#895](https://github.com/zenskar/connector-service/pull/895)     | fix(tax): wire `UnsupportedCountryError` + `DuplicateInvoiceError` to their raise sites              | 🟢 OPEN — stacked on #890. Two-bug, ~5-min review. Wires `UnsupportedCountryError` (`tax_info_policy` catches `ValueError` from `get_tax_config` → typed 400 instead of latent 500) + `DuplicateInvoiceError` (`DocumentCodeConflict` override in `error_translator` → 409 instead of 400). Plus tests for both.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S-cleanup    | [#896](https://github.com/zenskar/connector-service/pull/896)     | refactor(tax): structural cleanup — lift country configs, neutralize AVALARA exceptions, drop unused | 🟢 OPEN — stacked on #895. **No new behavior** — pure structural sweep, reviewable by skimming each commit. Five commits: (1) lift `core/utils/tax/` (28 files) → `core/domains/tax/policies/country_configs/`; (2) rename `AVALARA_VAT_ID_MISSING_ERROR` / `AVALARA_SERVICE_END_MISSING` → `MissingVatIdError` / `MissingServicePeriodEndError` under `core/domains/tax/exceptions.py` (verified zero refs in `backend` + `serverless-backend`), drop the `LegacyTaxCalculationService` `try/except TaxConnectorError → BadRequestException` wrapper that was flattening typed errors, delete 3 unused exception classes (`TaxConfigurationError`, `DiscountDistributionError`, `MappingLookupError`); (3) drop redundant `_tax_config` suffix on country files (`uk_tax_config.py` → `uk.py`, `tax_config.py` → `base.py`); (4) replace `tax_regions.json` + on-every-call disk read with typed `Mapping[str, str]` constant; relocate tax-config tests under `tests/core_test/domains/tax/`; (5) trim redundant docstrings on `TaxConnectorError` hierarchy. 1863 tests pass. |
| S-typed-seam | [#897](https://github.com/zenskar/connector-service/pull/897)     | refactor(tax): type the country-config seam end-to-end                                               | 🟢 OPEN — stacked on #896. **The actual refactor.** Type `TaxConfig.update_tax_document(**args)` → `(self, document: TaxDocument, context: EnrichmentContext) -> None` across the abstract base + 24 country configs + `tax_info_policy.py` (drops the transient-dict construction + field copy-back); same cleanup on `get_conversion_rate(**args)` → typed kwargs; introduce `CustomerTaxInfo` / `CustomerCustomData` value objects under `core.domains.tax.value_objects` and retype `EnrichmentContext.tax_info` / `custom_data` to use them; mappers (`app/tax/mappers.py`, `connectors/avalara/mappers/request_mapper.py`) construct VOs at the HTTP boundary; `is_b2c` and `apply_exemption_in_place` consume the typed VOs directly. Country-config tests (~200 cases) keep dict-mutation shape via `tests/core_test/domains/tax/_helpers.call_update` adapter — production code never goes through the helper. 1863 tests pass.                                                                                                                                         |
| ~~S1~~       | ~~[#892](https://github.com/zenskar/connector-service/pull/892)~~ | ~~original mixed-purpose S1~~                                                                        | 🔴 CLOSED 2026-05-09 — superseded by #895/#896/#897                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ~~S2~~       | ~~[#893](https://github.com/zenskar/connector-service/pull/893)~~ | ~~original mixed S2~~                                                                                | 🔴 CLOSED 2026-05-09 — superseded by #896                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ~~S3~~       | ~~[#894](https://github.com/zenskar/connector-service/pull/894)~~ | ~~original S3 with bundled docstring cleanup~~                                                       | 🔴 CLOSED 2026-05-09 — superseded by #897                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### Files now on main

- [core/domains/tax/](core/domains/tax/) — `models.py`, `enums.py`, `exceptions.py` (TAX\_\* codes), `value_objects.py` (CurrencyCode + CountryCode), `policies/{exemption,discount,customer_segmentation}.py`. Hoisted by H2b; renamed by H2c.
- [core/plugin/handlers/base_tax_handler.py](core/plugin/handlers/base_tax_handler.py) — **NEW** since 2026-05-06 via H1 (#868). 103 lines. ABC with `estimate_tax`, `create_tax`, `report_credit_note` abstract methods. Avalara inherits via `class Avalara(BaseTaxHandler, PluginCore)`.
- [app/tax/mappers.py](app/tax/mappers.py) — **NEW** since 2026-05-07 via H3a (#869). 327 lines. `request_to_tax_document`, `tax_quote_to_response`, `address_request_to_address`, `address_to_response`, `request_to_enrichment_context`, `credit_note_request_to_refund`. No callers wired in yet — H3b is the wire-up.
- [connectors/avalara/domain/](connectors/avalara/domain/) — directory remains but only `__init__.py` left. The original `models.py`, `enums.py`, `exceptions.py` were **deleted**, not shimmed.
- [connectors/avalara/policies/](connectors/avalara/policies/) — only `reporting_currency_policy.py` and `tax_info_policy.py` remain (the Avalara-specific ones); the 3 neutral policies were hoisted out and source files deleted.
- [app/tax/schema.py](app/tax/schema.py) — slimmed; re-exports `CurrencyCode` from `core.domains.tax.value_objects` for HTTP-layer field types.
- [connectors/avalara/main.py](connectors/avalara/main.py) — **inherits `BaseTaxHandler` on main** (since H1 merge). 479 lines — port methods (`estimate_tax`, `create_tax`, `report_credit_note`) live alongside legacy splat methods (`estimate_sales_tax`, `create_sales_tax`, `commit_tax`, `calculate_sales_tax`, `report_credit_note_legacy`, `validate_resource`).

### What's still missing on main

- **H3b wiring** — [app/tax/service.py](app/tax/service.py) still passes `**request.dict()` to the plugin at 4 call sites post-H3b (lines 178, 264, 457, 519: `/tax/create`, multi-code `/tax/report_credit_note` fallback, legacy `/tax/sales`, `/tax/commit`). The `# TODO(H3)` marker that was at line 49 is removed on the H3b branch. H3b removes the splats for `/tax/estimate` and the single-parent path of `/tax/report_credit_note`. `/tax/create` is **deliberately deferred** — see Suggested Work #0; `/tax/sales` and `/tax/commit` stay splat by design.
- **H3c cleanup** — `Avalara.estimate_sales_tax` splat method, `TaxPlugin` wrapper class, and `AdjustTransaction` scaffold (gateway op + schema + enum + tests) are still on main; H3c retires them.
- **#880 (TaxRateCatalogPort)** — port + value object exist on the `feat/tax-base-handler-widen` branch only. Concrete adapters (NetSuite, Xero, QB, Zoho) remain TBD; existing AccountingPlugin adapters still override `get_tax_rates` / `create_tax_rate` directly on the plugin class.

### Plan deviations vs what actually shipped

1. **H2a rejected.** Originally planned as purely-additive scaffolding (rounding policy, currency_normalization policy, plus a value object). None had production callers — only their own tests. YAGNI won and the PR was closed.
2. **H2b shipped without shims.** The plan originally proposed re-export shims at `connectors/avalara/domain/{models,enums,exceptions}.py` so callers wouldn't need import-path changes. The merged form migrated ~40 import paths directly and deleted the originals. Cleaner end state, slightly larger diff.
3. **H2c split out from H2b.** Originally the wire-code rename was in-scope for H2b. Splitting it out gave reviewers a behaviour-change PR that's revertable in isolation if observability surfaces an unexpected dependency on the old codes.
4. **H3b scope narrower than plan.** The plan said H3b would "remove the five `**request.dict()` splats at `app/tax/service.py:112,172,234,427,489` and delete the Avalara legacy splat methods that nothing calls anymore". The merged-form-to-be of H3b only migrates **two** routes through the port (`/tax/estimate` + single-parent `/tax/report_credit_note`); **4 splat sites remain on main post-H3b** (`/tax/create`, multi-code `/tax/report_credit_note` fallback, legacy `/tax/sales`, `/tax/commit`). **`/tax/create` is deliberately not migrated** — its response is the full Avalara `TransactionModel` envelope (status, summary[], full lines[] with details, addresses[], messages[]) consumed by backend's journal-line builder, and migrating to a `TaxQuote`-only response would be a backend-coordinated breaking change. Tracked as a follow-up (see "Suggested further work #0"). `/tax/sales` and `/tax/commit` (legacy single-line + commit-only routes) stay on splats by design.
5. **H3c was not in the original plan.** Originally the dead-code cleanup, `TaxPlugin` retirement, and `AdjustTransaction` removal were lumped into H3b. Splitting them out keeps H3b a wiring change and H3c a pure deletion — each PR reviewable in isolation, each easy to revert. Adds one more PR to the queue (now 13 in total) but improves review tractability.
6. **`TaxRateCatalogPort` (#880) is a second port not in the original plan.** The original plan treated `BaseTaxHandler` as **the** tax port. While auditing ERP tax-code CRUD (NetSuite SuiteQL discovery, QBO tax-code fetch, etc.), it became clear that tax assessment (calc trio: `estimate_tax` / `create_tax` / `report_credit_note`) and ERP tax-rate-catalog CRUD (`list_tax_rates` / `get_tax_rate_by_id` / `create_tax_rate`) operate on **different aggregate roots** with different lifecycles and different application-service consumers. Folding both onto one ABC would mean every adapter declares methods it doesn't fulfil and the type system stops enforcing role compliance. The plan now has **two single-role ports**: `BaseTaxHandler` (tax-engine adapters: Avalara, Anrok, Taxjar) and `TaxRateCatalogPort` (ERP tax-code-catalog adapters: NetSuite, Xero, QB, Zoho). This is a cleaner DDD shape — port-per-role rather than port-per-domain.
7. **R2's "raise the typed exceptions from policy" never landed; cleaned up retroactively in S1 (#892).** The plan-of-record (Error-constructor tightening rides with R2) said R2 would be "the first PR whose code raises the enriched exception types (`CurrencyConversionError`, `TaxConfigurationError`, `DiscountDistributionError` from policy modules)". In practice only `CurrencyConversionError` got wired; the other 4 (`TaxConfigurationError`, `DiscountDistributionError`, `MappingLookupError`, `UnsupportedCountryError`, plus the unused `DuplicateInvoiceError`) shipped as defined-but-never-raised classes. Audited in S1 (#892): `UnsupportedCountryError` had a clean wire site (`tax_info_policy` was bubbling `ValueError` from `get_tax_config` as a 500 instead of a typed 400) and `DuplicateInvoiceError` had one (`_ERROR_CODE_OVERRIDES["DocumentCodeConflict"]` in `error_translator`) — wired both. The other three had no distinguishing raise site and were deleted (YAGNI). Side effect: dropped the `LegacyTaxCalculationService.try/except TaxConnectorError → BadRequestException` wrapper around `enrich_tax_document_in_place` because it was flattening the new typed errors back to a generic `BadRequestException`, defeating the rename.
8. **Country tax configs lifted from `core/utils/tax/` into `core/domains/tax/policies/country_configs/` in S1.** Originally not in the plan — `core/utils/tax/` was treated as below-the-fold infrastructure. The audit during S1 found that the country configs encoded domain rules (what's a B2B requirement; what's a tax-point shift), so they belong in the bounded context. Moved 28 files; updated 5 external importers (avalara/policies × 2, xero/tax_distribution comment, 4 test files). The `AVALARA_VAT_ID_MISSING_ERROR` / `AVALARA_SERVICE_END_MISSING` raised by 16 of these configs were also renamed to neutral `MissingVatIdError` / `MissingServicePeriodEndError` under `core/domains/tax/exceptions.py` — verified `backend` and `serverless-backend` had zero references to the old wire codes, so no coordination needed.

9. **S2 split into two PRs (#893, #894).** The original S2 plan was a single follow-up covering five "tail" items. After scoping, items 1+3 (typed `update_tax_document` seam) plus item 4 (`EnrichmentContext` field VOs) added up to ~30 source files plus ~2,500 lines of test rewrites — too much to bundle with the trivial typed-registry and test-relocation pieces. Split: #893 ships items 2 + 5 (typed EU registry, drop `tax_regions.json`, move tests under `tests/core_test/domains/tax/`); #894 ships the seam typing + VO introduction + a docstring cleanup pass. Item 5 (test layout) and item 2 (typed registry) are now S2; the bigger seam-typing work is S3. Country files also got a `_tax_config` suffix drop (`uk_tax_config.py` → `uk.py`, etc.) added to S1 since the rename rides cleanly on the same PR.

10. **Tests stayed dict-shaped via a test-side adapter in S3.** The country-config unit tests (~200 cases in `test_new_country_tax_configs.py` plus more in `tax_utils_test.py`) historically called `update_tax_document(tax_document={...}, tax_info=[...], tax_field=...)` with a dict and asserted on `tax_document[KEY]`. Rewriting every callsite to construct typed objects + assert on attribute access would have ballooned the diff into the thousands of lines for no semantic gain — the tests are still testing the right rules, just on a typed seam. S3 introduces a one-file `tests/core_test/domains/tax/_helpers.call_update` adapter that builds `TaxDocument` + `EnrichmentContext` from the legacy kwargs, runs the typed seam, and mirrors the seam's two writes (`business_identification_no`, `document_date`) back into the test's dict so existing assertions pass unchanged. Production code never touches the helper. `TaxConfig.get_vat_id` retains a `dict | list[dict] | list[CustomerTaxInfo]` polymorphic accept-shape on the same grounds: tests call it directly with raw dicts, production callers always pass VOs.

After S1 + S2 + S3, `core/domains/tax/` has no upward imports, no module-import I/O, every seam typed end-to-end, and all errors carry `TAX_*` wire codes from the domain layer. Anrok adapter (H4) can be built directly against `core.domains.tax.policies.*` with no Avalara dependencies.

1. **S-series re-sliced 2026-05-09 from 3 PRs to 3 PRs by _commit type_ rather than work-stream.** The original chain (#892 → #893 → #894) was structured as "everything-1, everything-2, everything-3" — each PR mixed bugfix + structural cleanup + refactor, and the chain alternated cleanup ↔ refactor ↔ cleanup-then-refactor. A reviewer reading the chain saw the same file types touched repeatedly with different intents per PR; mental model kept resetting. Re-sliced into three single-purpose PRs by commit type: **#895 (bugfixes only — 4 files, ~5 min review)**, **#896 (structural cleanup, no behavior change — reviewable by skimming each commit)**, **#897 (the actual typed-seam refactor — focused diff to study carefully)**. Same end state, narrower per-PR narrative. Reviewers can pick depth per-PR: skim #896 for noise, study #897 for correctness, glance at #895. The closed PRs (#892/#893/#894) are kept linked from their replacements so the discussion history isn't lost.

2. **Smoke-discovered regression in H3b's report_credit_note path; fix landed inline (2026-05-09).** Smoke-testing the full stack (`/tmp/avalara_smoke_all.py`, 36 checks) against the 5 open branches surfaced 4 fails on PRs 888-897 (`new CN 200`, `new CN list has 1`); main was clean. Root cause: the new `_single_parent_refund` in `connectors/avalara/application/credit_note_service.py` constructs `Refund(credit_note_id=credit_note_id or "")` from a value that the API schema had typed `Optional[UUID]`. Pydantic coerced str → UUID at the API boundary, then the domain `Refund` model (typed `credit_note_id: str`) rejected the UUID. Bug never showed in tests because `tests/app_tests/tax/test_mappers.py:credit_note_request_to_refund` exercises the _mapper_ path which already does `str(request.credit_note_id or "")` defensively — the splat path that the regression lives on isn't tested at the unit level. Fixed in two commits (no new PRs): **(a)** H3b amend `bbd315f8` retypes `ReportCreditNoteRequestSchema.credit_note_id: str` (required, no Optional — backend always sends it via `jsonable_encoder` which has already serialized UUID → str on the wire) and `invoice_id: Optional[str]` (mirroring backend's `connectory.py:1570` signature). Test fixture also updated: `_request(credit_note_id=str(uuid4()))` to satisfy the strict-str validator. **(b)** H3c added `bc81915a` — pre-validator on `Refund.credit_note_id` that coerces UUID → str at the domain boundary, plus 3 unit tests (UUID coerced, str pass-through, None → ""). Architectural intent: the domain model is now the single source of truth for the str-coercion that mapper and connector previously each did inline; future construction sites (programmatic dispatch, port adapters, tests, the next plugin's adapter) get the right behaviour for free without having to remember the cast. After the fix, smoke is **32/36 PASS on every branch** (the remaining 4 fails are the `reporting_currency_*`-keys-omitted-instead-of-null behaviour from `attach_reporting_currency_in_place` when invoice currency = country reporting currency, present on main, not a regression). PR 888 CI fully green (`lint: pass`, `test: pass 2m8s`); 890→897 carry the fix forward via cascade rebase. The non-regression on main + the absence of unit-test coverage of the splat path is the lesson — Suggested further work #11 added below.

### Original "current state" snapshot (2026-05-03, pre-merge)

Kept for reference; superseded by the table above.

### R-series — MERGED

| Plan PR    | GitHub PR                                                                        | Title                                                                                           | Status    |
| ---------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------- |
| R1         | [#830](https://github.com/.../pull/830)                                          | refactor(avalara): enrich domain models, exceptions, enums                                      | ✅ MERGED |
| R2         | [#831](https://github.com/.../pull/831)                                          | feat(avalara): policy modules (exemption, discount, segmentation, reporting currency, tax info) | ✅ MERGED |
| R3         | [#832](https://github.com/.../pull/832)                                          | feat(avalara): schemas, infrastructure gateway, operations, fakes                               | ✅ MERGED |
| R4         | [#834](https://github.com/.../pull/834)                                          | feat(avalara): request/response mappers and address parsing helper                              | ✅ MERGED |
| R5a        | [#838](https://github.com/.../pull/838)                                          | feat(avalara): use-case service classes + ports + config                                        | ✅ MERGED |
| R5b        | [#839](https://github.com/.../pull/839)                                          | feat(avalara): main.py as composition root + facade tests                                       | ✅ MERGED |
| follow-ups | [#849](https://github.com/.../pull/849), [#851](https://github.com/.../pull/851) | review fix-ups                                                                                  | ✅ MERGED |
| R6/R7/R8   | —                                                                                | folded into R5b / dropped                                                                       | n/a       |

### Actuals vs plan estimates (R-series)

| File / area                                                                        |               Plan after R-series |                                                                                      Actual on `main` | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------- | --------------------------------: | ----------------------------------------------------------------------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [connectors/avalara/main.py](connectors/avalara/main.py)                           |                              ~410 |                                                                                               **409** | facade as designed                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [connectors/avalara/domain/models.py](connectors/avalara/domain/models.py)         |                               291 |                                                                                               **293** | matches                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| [connectors/avalara/domain/exceptions.py](connectors/avalara/domain/exceptions.py) |                               308 |                                                                                               **249** | already trimmed (`f1d8048e`); H2b still hoists what remains                                                                                                                                                                                                                                                                                                                                                                                      |
| [connectors/avalara/policies/](connectors/avalara/policies/)                       |                           6 files |                **5 files** (exemption, discount, customer_segmentation, reporting_currency, tax_info) | matches                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| [connectors/avalara/application/](connectors/avalara/application/)                 |                        7 services |                                                   **6 services + ports.py + config.py + **init**.py** | TaxCalculation, LegacyTaxCalculation, CreditNote, AddressValidation, CredentialsLifecycle                                                                                                                                                                                                                                                                                                                                                        |
| [connectors/avalara/infrastructure/](connectors/avalara/infrastructure/)           | gateway + repo + translator + ops |           **avatax_client.py 79, credentials_repository.py 40, error_translator.py 173, operations/** | matches                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| [connectors/avalara/mappers/](connectors/avalara/mappers/)                         |                           5 files | **6 files** (request, response, address, tax_document_mapper, tax_response_mapper, \_address_parsing) | one extra mapper                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [app/tax/service.py](app/tax/service.py)                                           |                              ~440 |                                                                            **560** (post-H1, pre-H3b) | 4 splats remaining post-H3b: `/tax/create` (line 178), `/tax/report_credit_note` multi-code fallback (264), `/tax/sales` legacy calculate (457), `/tax/commit` (519). `/tax/create` stays splat **pending the backend audit in Suggested Work #0** (it's the largest residual splat — see #0 for the lossy / envelope / status-quo decision matrix). `/tax/sales` and `/tax/commit` stay splat by design. TODO(H3) marker removed on H3b branch. |
| [api/tax.py](api/tax.py)                                                           |                               308 |                                                                                               **273** | new `/estimate`, `/create`, `/update` routes shipped                                                                                                                                                                                                                                                                                                                                                                                             |

### H-series gap — what remains

Two PRs remain in review (H3b + H3c) and one new architectural element
(#880) is in flight; everything else has shipped to `main`:

- ✅ [core/domains/tax/](core/domains/tax/) — present (H2b, H2c).
- ✅ [core/plugin/handlers/base_tax_handler.py](core/plugin/handlers/base_tax_handler.py) — present (H1, merged 2026-05-06). `connectors/avalara/main.py` declares `class Avalara(BaseTaxHandler, PluginCore)`.
- ✅ [app/tax/mappers.py](app/tax/mappers.py) — present (H3a, merged 2026-05-07).
- 🟢 [app/tax/service.py](app/tax/service.py) — H3b (#888) wires `/tax/estimate` and single-parent `/tax/report_credit_note` through the port. **4 splat sites remain post-H3b**: `/tax/create` (deferred — see Suggested Work #0), multi-code `/tax/report_credit_note` fallback, legacy `/tax/sales`, and `/tax/commit`. The last two stay splat by design.
- 🟢 H3c (#890) — drops `Avalara.estimate_sales_tax` splat (dead after H3b), removes `TaxPlugin` no-op wrapper, retires `AdjustTransaction` scaffold.
- 🟢 #880 — adds `TaxRateCatalogPort` and `ErpTaxCode` for ERP tax-rate-catalog adapters. New element; does not block H3b/H3c.

### Goal of remaining work

The H-series + #880 take the well-factored plugin-internal hex that
the R-series delivered for Avalara, and lift its DDD boundaries up so
that the tax domain is properly hexagonal across **two orthogonal
roles**:

- **Tax assessment** (calc trio: `estimate_tax` / `create_tax` /
  `report_credit_note`) — port: `BaseTaxHandler`. Adapters today:
  Avalara. Adapters next: Anrok. Aggregate root: tax transaction.
- **ERP tax-rate catalog** (catalog CRUD: `list_tax_rates` /
  `get_tax_rate_by_id` / `create_tax_rate`) — port:
  `TaxRateCatalogPort` (#880). Adapters today: none yet (existing
  AccountingPlugin adapters still override on the plugin class
  directly). Adapters next: NetSuite, Xero, QB, Zoho. Aggregate root:
  tax-rate reference data.

Both ports sit alongside the other `Base*Exporter` ABCs in
`core/plugin/handlers/` and speak domain-language types from the shared
`core/domains/tax/` layer. The **application layer** (`app/tax/`)
translates HTTP transport schemas to domain types at a single seam
(`app/tax/mappers.py`), so tax-engine plugins never see Pydantic
request models again. ERP tax-code CRUD currently has no analogous
HTTP↔domain mapper boundary — the existing wire shape (`{tax_type:
str, ...}` dict) is consumed directly by `core/plugin/tax_handler.py`,
and `ErpTaxCode.tax_type` is a Pydantic alias to bridge that consumer
until it's migrated.

Why two ports rather than one: tax assessment and ERP tax-code CRUD
operate on different aggregate roots with different lifecycles and
different application-service consumers. Folding both onto one ABC
would mean every adapter declares methods it doesn't fulfil and the
type system would stop enforcing role compliance. Two single-role
ports keep `@abstractmethod` honest — tax-engine adapters mix in
`BaseTaxHandler`; AccountingPlugin adapters set
`tax_rate_catalog_class` to a `TaxRateCatalogPort`.

Anrok (or any second tax-engine provider) is **out of scope for this
plan** — it will land in a future PR once the calc port and shared
domain exist. ERP tax-rate-catalog **concrete adapters** (NetSuite,
Xero, QB, Zoho) are also out of scope for the H-series proper — #880
only ships the port + value object + `AccountingPlugin.tax_rate_catalog_class`
slot. Concrete catalog adapters land in follow-up PRs driven by
ERP-team priorities (see the open NetSuite tax-discovery PRs #881,

# 884, #885).

## Impact assessment

This plan lands **on top of PR #820** (`feat/avalara-adjust-transaction` →
`main`), which is already a large refactor (+10,503 / −2,397, 79 files).
Much of the plugin-internal hex structure this plan relies on **is
already in PR #820**, so the tax-domain refactor is additive, not a
rewrite.

### What PR #820 already delivers (vs `main`)

| Area                                   | PR #820 status                                                                                                                       | Size                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `connectors/avalara/application/`      | **NEW** — per-use-case services (create, estimate, update, credit-note, address-validation, credentials-lifecycle)                   | +1,341 lines, 9 files        |
| `connectors/avalara/infrastructure/`   | **NEW** — `avatax_client.py`, `credentials_repository.py`, `error_translator.py`, `operations/{addresses,transactions,utilities}.py` | +780 lines, 8 files          |
| `connectors/avalara/policies/`         | **NEW** — `exemption`, `discount`, `customer_segmentation`, `reporting_currency`, `tax_info`                                         | +315 lines, 6 files          |
| `connectors/avalara/domain/`           | **ENRICHED** — `models.py` 203→291, `exceptions.py` 68→308, `enums.py` 42→43                                                         | +379 / −64                   |
| `connectors/avalara/main.py`           | **SHRUNK** — business logic hoisted out to application/infrastructure                                                                | 1,026 → 372 lines (−654 net) |
| `tests/_support/fakes/`                | **NEW** — `FakeAvaTaxGateway`, `FakeCredentialsRepository`                                                                           | +184 lines                   |
| `tests/connector_tests/avalara_tests/` | **EXPANDED** — 16 new per-service/per-policy test files                                                                              | ~4,700 lines added           |
| `app/tax/service.py`                   | **ENRICHED** — new `/create`, `/estimate`, `/update` methods + decorators                                                            | 189 → 548 lines              |
| `api/tax.py`                           | **ENRICHED** — new routes, docstrings                                                                                                | 72 → 308 lines               |

PR #820 has already done the plugin-internal hex: ports-ish
contracts, gateway isolation, policy extraction, constructor-injected
dependencies, comprehensive fakes. The tax-domain refactor picks up
from that baseline.

### What PR #820 does NOT deliver (the tax-domain gap)

None of these exist on the branch yet:

- `core/domains/tax/` — no shared domain above plugins.
- `core/plugin/handlers/base_tax_handler.py` — no port ABC. Every
  other domain has one (`base_customer_exporter.py` 22KB,
  `base_invoice_exporter.py` 14KB, `base_payment_exporter.py` 11KB,
  `base_payout_exporter.py` 2KB, `base_refund_exporter.py` 10KB,
  `base_credit_note_exporter.py` 22KB); tax is the outlier.
- `app/tax/mappers.py` — no HTTP↔domain boundary; service still
  splats `**request.dict()` into the plugin.
- `app/tax/service.py` still passes transport-layer Pydantic models
  through to plugins, so the hex boundary stops at the plugin
  entrypoint.

That gap is what this plan closes.

### Estimated line-diff per file (hex refactor vs current branch)

Legend: **+** add, **−** delete, **∆** modify in place.

| File                                                  | Current branch | After hex refactor | Δ                  | Type                                                                                                        |
| ----------------------------------------------------- | -------------: | -----------------: | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `core/domains/tax/__init__.py`                        |              — |                ~10 | **+10**            | NEW                                                                                                         |
| `core/domains/tax/models.py`                          |              — |               ~270 | **+270**           | NEW (hoist from `connectors/avalara/domain/models.py`)                                                      |
| `core/domains/tax/value_objects.py`                   |              — |                ~90 | **+90**            | NEW (consolidates `CurrencyCode` + `CountryCode` from `app/tax/schema.py`)                                  |
| `core/domains/tax/exceptions.py`                      |              — |               ~180 | **+180**           | NEW (provider-neutral subset of `connectors/avalara/domain/exceptions.py`)                                  |
| `core/domains/tax/policies/exemption.py`              |              — |                ~35 | **+35**            | NEW (moved from avalara)                                                                                    |
| `core/domains/tax/policies/rounding.py`               |              — |                ~50 | **+50**            | NEW                                                                                                         |
| `core/domains/tax/policies/currency_normalization.py` |              — |                ~80 | **+80**            | NEW                                                                                                         |
| `core/plugin/handlers/base_tax_handler.py`            |              — |                ~90 | **+90**            | NEW (matches `base_payout_exporter.py` size)                                                                |
| `app/tax/mappers.py`                                  |              — |               ~180 | **+180**           | NEW                                                                                                         |
| `app/tax/service.py`                                  |            548 |               ~440 | **∆ ~−108 / +~30** | MODIFIED (`**request.dict()` removed, helper extracted, error translator added)                             |
| `app/tax/schema.py`                                   |            292 |               ~260 | **∆ −32**          | MODIFIED (`CurrencyCode`/`CountryCode` re-export from domain)                                               |
| `api/tax.py`                                          |            308 |                308 | —                  | UNCHANGED                                                                                                   |
| `connectors/avalara/main.py`                          |            372 |               ~410 | **∆ +~40**         | MODIFIED (declare `class AvalaraTaxPlugin(BaseTaxHandler)`, rewrite method bodies to receive `TaxDocument`) |
| `connectors/avalara/application/*.py` (×7)            |         ~1,341 |             ~1,290 | **∆ −~50**         | MODIFIED (signatures accept `TaxDocument`, remove dict unpacking)                                           |
| `connectors/avalara/mappers/*.py` (×5)                |           ~392 |               ~400 | **∆ +~8**          | MODIFIED (import path change: `.domain` → `core.domains.tax`)                                               |
| `connectors/avalara/domain/models.py`                 |            291 |                  — | **−291**           | DELETED (moved to core)                                                                                     |
| `connectors/avalara/domain/exceptions.py`             |            308 |               ~120 | **−188**           | REDUCED (provider-neutral moved up; Avalara-SDK-specific wrappers stay)                                     |
| `connectors/avalara/domain/enums.py`                  |             43 |                ~15 | **−28**            | REDUCED                                                                                                     |
| `connectors/avalara/policies/exemption_policy.py`     |             33 |                  — | **−33**            | DELETED (moved to core)                                                                                     |

**Source totals (excluding tests):**

- **Added:** ~985 lines across 9 new files.
- **Deleted:** ~540 lines across 4 deletions/reductions.
- **Modified:** ~240 lines across 10 files.
- **Net source delta:** ≈ **+445 / −540 / ∆240**, i.e. the codebase
  gets **smaller** because the hoist de-duplicates the provider-neutral
  layer.

### Estimated test delta

| File                                                           | Δ                         | Type             |
| -------------------------------------------------------------- | ------------------------- | ---------------- |
| `tests/core/domains/tax/test_models.py`                        | +~120                     | NEW              |
| `tests/core/domains/tax/test_value_objects.py`                 | +~60                      | NEW              |
| `tests/core/domains/tax/test_policies_exemption.py`            | +~60 (moved from avalara) | RELOCATED        |
| `tests/core/domains/tax/test_policies_rounding.py`             | +~50                      | NEW              |
| `tests/core/domains/tax/test_policies_currency.py`             | +~70                      | NEW              |
| `tests/app/tax/test_mappers.py`                                | +~200                     | NEW              |
| `tests/app/tax/test_service.py`                                | +~300                     | NEW              |
| `tests/tax/contracts/*` (×5)                                   | +~600                     | NEW              |
| `tests/_support/fakes/fake_tax_handler.py`                     | +~60                      | NEW              |
| `tests/_support/builders/tax.py`                               | +~80                      | NEW              |
| `tests/connector_tests/avalara_tests/test_exemption_policy.py` | −60                       | MOVED UP to core |

**Test totals:** ≈ **+1,540 new test lines**, **−60 relocated**.

### Cumulative impact vs `main`

Adding the hex-domain refactor to PR #820's baseline:

|                                    | PR #820 only | PR #820 + hex refactor |
| ---------------------------------- | -----------: | ---------------------: |
| Source lines added                 |      +10,503 |         +11,488 (~+9%) |
| Source lines deleted               |       −2,397 |                 −2,937 |
| Test lines added (subset of above) |      ~+4,900 |                ~+6,440 |
| Files touched                      |           79 |                   ~100 |

The hex refactor is ≈ **10% larger than PR #820 in added lines**, but
crucially **reduces net source footprint** (deletes more than it adds
in the `connectors/avalara/` tree because provider-neutral code is
hoisted, not copied).

### PR strategy: 12 small PRs, each branched from `main`

PR #820 is itself unreviewable at +10,503 / −2,397. Landing it as a
single unit and then stacking hex work on top is the wrong shape —
a reviewer has to hold 13k lines in their head just to understand the
starting point. The better plan is to **retire PR #820 in its current
form and re-slice its contents plus the hex refactor into twelve
smaller PRs, each branching from `main`**, with disciplined technique
so dependencies don't force a git-stack.

### Techniques that make every PR a `main`-based PR

The core trick is **trade transient duplication for review
tractability**. Specifically:

1. **Additive-first.** New files only; never modify existing files in
   the same PR that introduces them. Half the PR 820 content
   (`application/`, `infrastructure/`, `policies/`, most mappers,
   `tests/_support/fakes/`) is genuinely additive — it can ship as
   pure new code that isn't called yet.
2. **Parallel implementation, deletion-last.** When replacing the
   inline logic in `connectors/avalara/main.py` with application
   services, **don't delete the inline logic in the same PR**. Ship
   the new services unused first; wire up the new endpoints to call
   them; only in a final "retire legacy" PR remove the duplicated
   code from `main.py`. Temporary duplication is a _feature_ for
   reviewability.
3. **Re-export shims for hoists.** When moving domain types up to
   `core/domains/tax/`, leave a one-line re-export in
   `connectors/avalara/domain/models.py` (`from core.domains.tax.models
import *`) so no existing caller breaks. The deletion of the shim
   is its own tiny PR after all callers are migrated.
4. **Test-only PRs.** Tests that exercise already-merged production
   code can always ship as their own `main`-based PR. The ~4,700
   lines of new tests inside PR #820 can be their own PR without
   blocking the source changes.
5. **Merge-order dependency, not git-stack dependency.** If PR B
   needs PR A merged, B still branches from `main` — it just waits
   to open or waits to rebase after A merges. Stacking via
   `git worktree` / `gh pr create --base <branch>` adds review
   friction (reviewer must mentally subtract A's diff from B's).

### The 12 PRs

Dependencies are listed as **merge-order** requirements, not git-base
requirements. Every PR in the table has `base = main`.

| #                                                          | Title                                                                                                                                                                                                                                                                                                        |         Est. size | Depends on             | Review | Risk   | Status                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------: | ---------------------- | -----: | ------ | ----------------------------------------------------------------------- |
| **Re-slicing PR #820 — DONE**                              |                                                                                                                                                                                                                                                                                                              |                   |                        |        |        |                                                                         |
| R1                                                         | `refactor(avalara): enrich domain models, exceptions, enums` (#830)                                                                                                                                                                                                                                          |               587 | —                      |    30m | low    | ✅ MERGED                                                               |
| R2                                                         | `feat(avalara): policy modules` (#831)                                                                                                                                                                                                                                                                       |         758 + ~80 | R1                     |    35m | low    | ✅ MERGED                                                               |
| R3                                                         | `feat(avalara): schemas, infrastructure gateway, operations, fakes` (#832)                                                                                                                                                                                                                                   |       2,334 + ~60 | R1                     |     1h | low    | ✅ MERGED                                                               |
| R4                                                         | `feat(avalara): request/response mappers and address parsing helper` (#834)                                                                                                                                                                                                                                  |             1,127 | R1 + R3                |    45m | low    | ✅ MERGED                                                               |
| R5a                                                        | `feat(avalara): use-case service classes + ports + config` (#838)                                                                                                                                                                                                                                            |           ~+2,700 | R1, R2, R3, R4         |    45m | low    | ✅ MERGED                                                               |
| R5b                                                        | `feat(avalara): main.py composition root + facade tests + new HTTP routes` (#839)                                                                                                                                                                                                                            | ~+4,400 / ~−2,700 | R5a                    |   1.5h | medium | ✅ MERGED                                                               |
| R6                                                         | folded into R5b                                                                                                                                                                                                                                                                                              |                 — | —                      |      — | —      | n/a                                                                     |
| R7                                                         | folded into R5b                                                                                                                                                                                                                                                                                              |                 — | —                      |      — | —      | n/a                                                                     |
| R8                                                         | dropped — cross-cutting items distributed naturally                                                                                                                                                                                                                                                          |                 — | —                      |      — | —      | n/a                                                                     |
| **Hex tax-domain refactor — IN PROGRESS (additive-first)** |                                                                                                                                                                                                                                                                                                              |                   |                        |        |        |                                                                         |
| ~~H2a~~                                                    | ~~`feat(tax): scaffold core/domains/tax primitives`~~ — closed as speculative; no production callers, only its own unit tests.                                                                                                                                                                               |                 — | —                      |      — | —      | ❌ CLOSED [#864](https://github.com/zenskar/connector-service/pull/864) |
| H2b                                                        | `refactor(tax): hoist domain to core/domains/tax + migrate imports` — structural only; ~40 caller import paths migrated; `connectors/avalara/domain/` deleted (no shims). Wire codes still `AVALARA_*` — rename is H2c.                                                                                      |              ~900 | —                      |    45m | low    | ✅ MERGED [#865](https://github.com/zenskar/connector-service/pull/865) |
| H2c                                                        | `refactor(tax): rename AVALARA_* wire codes to TAX_* and neutralize message templates` — wire-level rename + message-template neutralization in one PR; downstream-consumer audit (frontend + backend) cleared the rename.                                                                                   |              ~150 | H2b                    |    15m | medium | ✅ MERGED [#867](https://github.com/zenskar/connector-service/pull/867) |
| H1                                                         | `feat(tax): BaseTaxHandler port + Avalara additive conformance` — port has 3 abstract methods: `estimate_tax`, `create_tax`, `report_credit_note`.                                                                                                                                                           |          ~650–750 | H2b                    |    30m | low    | ✅ MERGED [#868](https://github.com/zenskar/connector-service/pull/868) |
| H3a                                                        | `feat(tax): app/tax/mappers.py — HTTP ↔ domain conversion, additive only`                                                                                                                                                                                                                                    |              ~400 | H2b                    |    25m | low    | ✅ MERGED [#869](https://github.com/zenskar/connector-service/pull/869) |
| H3b                                                        | `feat(tax): wire app/tax/service.py to BaseTaxHandler port` — migrates `/tax/estimate` and `/tax/report_credit_note` (single-parent) through the port + mappers. `/tax/create` stays on the legacy splat (vendor wire envelope response).                                                                    |        +274 / −53 | H1 + H3a               |    30m | medium | 🟢 OPEN [#888](https://github.com/zenskar/connector-service/pull/888)   |
| H3c                                                        | `chore(tax): cleanup — drop dead splat methods, remove TaxPlugin wrapper, retire AdjustTransaction scaffold` (single_parent_refund refactor folded into H3b)                                                                                                                                                 |       +312 / −823 | H3b                    |    30m | low    | 🟢 OPEN [#890](https://github.com/zenskar/connector-service/pull/890)   |
| #880                                                       | `feat(tax): TaxRateCatalogPort + ErpTaxCode for ERP tax-code adapters` — second driving port (catalog CRUD), `ErpTaxCode` value object with `tax_type` alias bridging `core/plugin/tax_handler.py:229`, `tax_rate_catalog_class` slot on `AccountingPlugin`. **Independent of H3b/H3c**, parallel to wave 3. |         +261 / −9 | — (parallel to wave 3) |    30m | low    | 🟢 OPEN [#880](https://github.com/zenskar/connector-service/pull/880)   |
| H4                                                         | _(future, not in this plan)_ `feat(anrok): tax plugin implementing BaseTaxHandler` — lands when Anrok is prioritised                                                                                                                                                                                         |              ~400 | H3c                    |      — | —      | deferred                                                                |
| ERP-cat                                                    | _(future, not in this plan)_ per-ERP `TaxRateCatalogPort` adapters (NetSuite, Xero, QB, Zoho) — driven by ERP-team priorities                                                                                                                                                                                |              ~tbd | #880                   |      — | —      | deferred                                                                |

**Totals:** 12 PRs; largest is ~2,500 lines (test-only, fastest to
review); median ~500 lines; ~7 hours of cumulative reviewer time
spread across the queue. Compare to the status quo: ~1 reviewer-day
wrestling with a 13k-line PR.

### Dependency DAG (current — H-series + #880)

```
                wave 1            wave 2                          wave 3                           wave 4
              ┌──────┐         ┌──────────────────┐
[R1..R5b]────►│ H2b  │─────┬──►│ H2c (rename only)│ ✅ merged
              └──────┘     │   └──────────────────┘
              ✅ merged    │   ┌──────────────────┐
                           ├──►│ H1 (port)        │──┐ ✅ merged
                           │   └──────────────────┘  │
                           │   ┌──────────────────┐  ├─► H3b (wire 2 routes) ──► H3c (cleanup)
                           └──►│ H3a (mappers)    │──┘ 🟢 #888                   🟢 #890
                               └──────────────────┘   merged into H3b stack      stacked on H3b
                               ✅ merged

                                  parallel track
                               ┌─────────────────────────────────┐
[main]────────────────────────►│ #880 TaxRateCatalogPort         │ 🟢 OPEN
                               │ + ErpTaxCode + AccountingPlugin │ no H-series dep
                               │ slot                            │
                               └─────────────────────────────────┘

(future) H4 (Anrok adapter)        │     │
(future) ERP-cat adapters per ERP  │     ▼
(NetSuite, Xero, QB, Zoho)         │   #881 NetSuite SuiteQL discovery (read-only) — open
                                   │   #884 NetSuite SalesTaxItem create — open
                                   │   #885 NetSuite Tax Agency/Type resolver — open
                                   │   #878 QBO tax code fetch — open
                                   │   #852 QBO connection setup — open
```

**Additive-first principle.** Every wave-1 / wave-2 PR except H2c is
**behaviour-preserving end-to-end**: existing requests reach the same
plugin code with the same arguments and produce the same wire
responses. The wire-code / message-template rename is its own PR
(H2c) so observability has a single, isolated diff to point at if
anything surfaces post-deploy. Behaviour finally changes in H3b,
where the application-layer service starts speaking domain types to
plugins instead of HTTP-schema dicts.

**Wave 1** — H2b only. Hoists provider-neutral types from
`connectors/avalara/{domain,policies}/` into `core/domains/tax/`,
migrates every caller's import path, and deletes the now-empty
old locations. **No wire-code changes, no message-template changes.**
Avalara still raises `InvalidAddressError` with `error_code =
"AVALARA_INVALID_ADDRESS"` and the message template "Avalara could
not resolve the address ..." after this PR — the only difference is
that those strings now live in `core/domains/tax/exceptions.py`
instead of `connectors/avalara/domain/exceptions.py`.

**Wave 2** — H2c, H1, and H3a run in parallel after H2b merges.

- **H2c** is the only behavioural PR in waves 1–2: renames
  `AVALARA_*` wire codes to `TAX_*` in
  `core/domains/tax/exceptions.py` and strips "Avalara" wording from
  default `message_template`s. Updates the wire-code assertions in
  `tests/connector_tests/avalara_tests/test_domain_exceptions.py`.
  Pre-merge audit (frontend + backend) cleared the rename as
  non-breaking; H2c keeps it isolated so observability has a single
  small diff to attribute if anything surfaces post-deploy.
- **H1** adds the port and makes Avalara _additively_ conform: new
  domain-typed methods (`estimate_tax`, `create_tax`,
  `report_credit_note`) live alongside the existing splat-style
  methods (`estimate_sales_tax`, `create_sales_tax`, `commit_tax`,
  `calculate_sales_tax`, `report_credit_note_legacy`,
  `validate_resource`). The port is intentionally minimal — only the
  methods with a real domain-typed contract are abstract.
  `app/tax/service.py` is **untouched** in H1.
- **H3a** ships `app/tax/mappers.py` as dead code with its own tests.

H2c, H1, H3a touch disjoint files
(`core/domains/tax/exceptions.py` for H2c, `core/plugin/handlers/`

- `connectors/avalara/main.py` for H1, `app/tax/mappers.py` for
  H3a), so any merge order works.

**Wave 3** — H3b is the only PR that touches both `app/tax/service.py`
_and_ the Avalara legacy methods. It wires mappers, removes the 5×
`**request.dict()` splats at `app/tax/service.py:112,172,234,427,489`,
and deletes the Avalara legacy splat methods that nothing calls
anymore. This is the only behavioural-change PR in the queue.

H4 is deferred — Anrok will be a separate, future PR built on top of
H3b.

### What happened to H2a

The original plan paired H2b with an H2a PR that pre-staged
provider-neutral primitives (rounding policy, currency-normalization
policy, plus a value object) so they would already exist when later
PRs needed them. PR #864 was opened on that basis, but a pre-merge
audit found that none of those exports had production callers — only
their own unit tests. Per YAGNI and the plan's own non-speculation
principle, shipping unused code in anticipation of a future PR is a
worse trade than letting each primitive land with the PR that
genuinely needs it. PR #864 was closed. The rounding /
currency-normalization helpers wait for the first caller. This drops
the wave-1 parallelism (no partner left to pair with H2b) but
improves the signal-to-noise of every remaining PR.

**R1 was strictly foundational** — R2, R3, R4 all consumed its enriched
domain types (`CurrencyConversionError`, `EnrichmentContext`,
`AvaTaxErrorResponseSchema` hierarchy etc.).

**Error-constructor tightening rides with R2.** R2 is the first PR
whose code raises the enriched exception types (`CurrencyConversionError`,
`TaxConfigurationError`, `DiscountDistributionError` from policy
modules). It therefore carries the exceptions.py base-class
simplification — drop `_MissingKeyDict`/`_safe_format`/the
`try/except` around `format_map`, use plain `format_map(context)`,
add typed `__init__` kwargs per subclass for the context keys the
template references. R3's `error_translator.py` then constructs
exceptions against the same typed contract (e.g.
`InvalidAddressError(cause=exc)`, `TaxCalculationUpstreamError(cause=exc)`).
Raise sites become statically audit-able; missing-context-key bugs
surface as `KeyError` in unit tests instead of producing blank-slot
messages in prod.

**R4 depends on R3** because the mappers import branch-enriched
schema types (`AdjustTransactionSchema`, `ListCountriesBodySchema`,
schemas/enums.py) that ship in R3. Schemas are the vendor-wire layer
and live alongside infrastructure, not with mappers, to avoid
duplication.

**R2 and R3 are parallel** after R1 merges.

The plan's earlier "R1–R4 all parallel" claim was incorrect; this is
the honest dependency shape after auditing the real imports.

### Rollout — what's left

R1–R5b merged 2026-04-15 → 2026-04-28. H2b + H2c merged 2026-05-06.
H1 merged 2026-05-06; H3a merged 2026-05-07. Wave 3 is in flight:
H3b (#888) and H3c (#890) are open PRs in review (H3c stacked on
H3b). The new ERP-catalog port (#880) is also open and runs as a
parallel track to wave 3. Concrete remaining rollout below; ✅ marks
completed steps.

**✅ Wave 1 — H2b, merged `ba31eca8` on 2026-05-06:**

1. **✅ H2b (structural, no behaviour change)** — hoisted types from
   `connectors/avalara/{domain,policies}/` into `core/domains/tax/`
   and migrated every caller. Concretely:
   - Copy `connectors/avalara/domain/{models,enums,exceptions}.py`
     content verbatim to `core/domains/tax/{models,enums,exceptions}.py`.
     **Wire codes stay `AVALARA_*`. Message templates keep "Avalara"
     wording.** This is a pure relocation — every observable string
     is identical to what main produces today.
   - Hoist `CurrencyCode` and `CountryCode` from `app/tax/schema.py`
     into `core/domains/tax/value_objects.py`.
   - Hoist the 3 provider-neutral policies (`exemption_policy`,
     `discount_policy`, `customer_segmentation_policy`) into
     `core/domains/tax/policies/`. `reporting_currency_policy` and
     `tax_info_policy` stay in `connectors/avalara/policies/` — they
     reference Avalara-specific types.
   - Update every caller across `connectors/avalara/`,
     `core/utils/tax/`, `app/tax/`, and tests to import from the new
     paths.
   - Delete `connectors/avalara/domain/` and the 3 policy files at
     the old location. No transitional shims.
   - Test assertions still expect `AVALARA_*` wire codes.

**✅ Wave 2 — all merged 2026-05-06 → 2026-05-07:**

1. **✅ H2c (behaviour change, isolated)** — renamed `AVALARA_*` wire
   `error_code` constants to neutral `TAX_*` codes in
   `core/domains/tax/exceptions.py` and stripped "Avalara" mentions
   from default `message_template`s. Updated wire-code assertions in
   `tests/connector_tests/avalara_tests/test_domain_exceptions.py`
   and `test_credit_note_service.py`. The pre-merge
   downstream-consumer audit
   (see [Downstream-consumer audit](#downstream-consumer-audit-2026-05-03))
   confirmed both frontend and backend handle wire codes opaquely.
2. **✅ H1 ([#868](https://github.com/zenskar/connector-service/pull/868))**
   — added [core/plugin/handlers/base_tax_handler.py](core/plugin/handlers/base_tax_handler.py)
   ABC and changed `connectors/avalara/main.py` to inherit from
   `BaseTaxHandler`. Port has 3 abstract methods: `estimate_tax`,
   `create_tax`, `report_credit_note`. New port methods added
   _alongside_ the existing splat-style methods — `app/tax/service.py`
   was untouched in H1. The port is intentionally minimal — only
   methods with a real domain-typed contract are abstract. Note:
   `report_credit_note` shipped as a `NotImplementedError` placeholder
   in H1; **H3b finishes its implementation** by fetching the parent
   transaction (currency + pre-tax basis) and delegating to
   `CreditNoteService.single_parent_refund`.
3. **✅ H3a ([#869](https://github.com/zenskar/connector-service/pull/869))**
   — added [app/tax/mappers.py](app/tax/mappers.py) (327 lines) with
   `request_to_tax_document`, `tax_quote_to_response`,
   `address_request_to_address`, `address_to_response`,
   `request_to_enrichment_context`, `credit_note_request_to_refund`,
   plus unit tests. Shipped as dead code with no callers — H3b is
   the wire-up.

**🟢 Wave 3 — H3b + H3c open in review:**

1. **🟢 H3b ([#888](https://github.com/zenskar/connector-service/pull/888))**
   — the application-layer behaviour change. Rewrites
   [app/tax/service.py](app/tax/service.py) for **two** routes:
   `/tax/estimate` (legacy single-line schema, uses new
   `legacy_estimate_request_to_tax_document` mapper) and
   `/tax/report_credit_note` single-parent path. Implements
   `Avalara.report_credit_note` properly: fetches parent transaction
   via `gateway.transactions.get_by_code` for currency + pre-tax basis,
   refunds via `CreditNoteService._single_parent_refund`, maps the
   wire response to a `TaxQuote`. Drops the `# TODO(H3)` marker.
   Diff: +274 / −53 across 5 files. **Scope deliberately narrower
   than the original plan** — see "Plan deviations" deviation #4.
   Three splats remain post-H3b by design (`/tax/sales`, `/tax/commit`,
   multi-code `/tax/report_credit_note` fallback). `/tax/create` stays
   on legacy splat indefinitely — see "Suggested further work #0".
2. **🟢 H3c ([#890](https://github.com/zenskar/connector-service/pull/890),
   stacked on H3b)** — three independent moves bundled because each is
   small and they share the H3b dependency:
   - **Drop dead code** — `Avalara.estimate_sales_tax(**args)` and
     `tax_quote_to_estimate_response` had zero callers after H3b
     migrated `/tax/estimate` through the port.
   - **Remove `TaxPlugin` wrapper** — `class TaxPlugin(PluginCore)` was
     a no-op wrapper (just `__init__` super-delegation +
     `validate_resource(**args): pass` stub). Avalara and Taxjar now
     inherit `PluginCore` directly.
   - **Retire `AdjustTransaction` scaffold** — gateway op,
     `AdjustTransactionSchema`, `AdjustmentReason` enum,
     error-translator entry, and tests removed. Speculative scaffold
     with zero application-layer callers.
   - **Plus fix G** from the post-H3b architecture review:
     `CreditNoteService._single_parent_refund` becomes a public method
     returning `TransactionResponseSchema` directly;
     `Avalara.report_credit_note` (port) drops the dict→schema
     roundtrip and the smelly reach into a private method.
     Diff: +45 / −779 across 13 files (lopsided — cleanup nature).

**🟢 Parallel track — #880 (open, runs alongside wave 3):**

1. **🟢 #880 ([#880](https://github.com/zenskar/connector-service/pull/880))**
   — adds the **second** tax-domain port:
   - `core/plugin/handlers/tax_rate_catalog_port.py` — driving port for
     ERP tax-rate-catalog adapters. Three abstract methods:
     `list_tax_rates`, `get_tax_rate_by_id`, `create_tax_rate`. Concrete
     adapters (NetSuite next, then Xero/QB/Zoho) must implement the trio.
   - `core/domains/tax/value_objects.py::ErpTaxCode` — value object with
     a `tax_type` Pydantic alias so `.dict(by_alias=True)` matches the
     legacy wire shape consumed by `core/plugin/tax_handler.py:229`.
     Domain code reads `code.id`; the alias is a temporary bridge until
     that consumer is migrated. Tracked as ACL debt — the alias is a
     temporary bridge, not a permanent shape choice.
   - `AccountingPlugin.tax_rate_catalog_class` slot +
     `_get_tax_rate_catalog()` accessor; existing `get_tax_rates` /
     `get_tax_rate_by_id` / `create_tax_rate` facades delegate to the
     catalog adapter when the slot is set, otherwise preserve
     `NotImplementedError`. New `get_tax_rate_by_id` facade.
     Diff: +261 / −9 across 5 files. **Does not touch `BaseTaxHandler`,
     Avalara, or `app/tax/`.** Existing AccountingPlugin adapters (Xero)
     still override `get_tax_rates` / `create_tax_rate` directly on the
     plugin class — their MRO short-circuits before the new facade.
     Migrating them onto `TaxRateCatalogPort` is follow-up work.

H4 (Anrok adapter implementing `BaseTaxHandler`) is a separate future
effort, started only when Anrok is prioritised. The plan deliberately
finishes the architectural seam _before_ the second provider arrives,
so the second provider's PR is small and additive instead of forking
the application layer.

ERP-catalog concrete adapters (NetSuite, Xero, QB, Zoho on
`TaxRateCatalogPort`) are similarly deferred. Several open PRs in the
NetSuite/QBO tax space (#878, #881, #884, #885) build the read-side
infrastructure that a future NetSuite `TaxRateCatalogPort` adapter will
sit on top of — they ship the SuiteQL discovery, SOAP create-tax-code
schema, and Tax Agency/Type resolver respectively, but **do not** yet
implement the port. Wiring them through `TaxRateCatalogPort` is a
follow-up.

### Reviewer effort budgeted

| Wave     | PRs      | Status                   | Parallel                |                 Wall-clock |
| -------- | -------- | ------------------------ | ----------------------- | -------------------------: |
| 1        | H2b      | ✅ merged                | n/a                     |                 45m (done) |
| 2        | H2c      | ✅ merged                | n/a                     |                 15m (done) |
| 2        | H1 + H3a | ✅ merged                | yes                     | max(30m, 25m) = 30m (done) |
| 3        | H3b      | 🟢 open                  | n/a                     |          **30m** in review |
| 3        | H3c      | 🟢 open (stacked on H3b) | n/a                     |          **30m** in review |
| parallel | #880     | 🟢 open                  | yes (independent track) |          **30m** in review |

~2h of reviewer time already spent (H2b + H2c + H1 + H3a). ~1.5h
remaining across wave 3's two stacked PRs (H3b + H3c) and the
parallel #880.

### Risk / deployability per PR

H3b is the only behaviourally-meaningful PR remaining; everything else is additive or pure refactoring.

- **H2b — refactoring, behaviour-preserving.** ✅ Shipped. Hoist +
  import migration. Every wire string the system produced was
  byte-identical to main. Low risk; deployed continuously.
- **H2c — wire-code rename, audited safe.** ✅ Shipped. Only PR that
  changed the observable error-code strings (`AVALARA_*` → `TAX_*`).
  Frontend + backend audited as non-breaking; observability dashboards
  keyed on the literal strings (Sentry, Datadog) are the residual
  unknown. Easy revert: one commit.
- **H1 — additive, no behaviour change.** ✅ Shipped. New ABC + new
  port methods on Avalara plugin (with `report_credit_note` deferred
  as `NotImplementedError` placeholder). Existing code paths untouched.
  Low risk.
- **H3a — dead code.** ✅ Shipped. `app/tax/mappers.py` shipped with
  no callers. Zero risk.
- **H3b — application-layer behaviour change.** Open as PR #888.
  Rewrites how `/tax/estimate` and single-parent `/tax/report_credit_note`
  reach the plugin. Three splats remain by design — `/tax/sales`,
  `/tax/commit`, multi-code `/tax/report_credit_note` fallback go through
  unchanged legacy paths. Implements `Avalara.report_credit_note`
  properly (was `NotImplementedError` placeholder from H1). The only
  remaining PR warranting deliberate canary or off-hours deploy.
  Mitigated by mapper unit tests and the existing E2E suite.
- **H3c — pure deletion (cleanup).** Open as PR #890, stacked on H3b.
  Behaviour-preserving — every removal targets code with zero callers
  after H3b. Easy revert.
- **#880 — additive, no behaviour change.** Open as PR #880, parallel
  track. Adds new port + value object + `AccountingPlugin` slot.
  Existing AccountingPlugin adapters (Xero) keep their direct overrides
  via MRO short-circuit. The new `get_tax_rate_by_id` facade is the only
  added API surface. Low risk; can deploy independently of H3b/H3c.

Waves 1 and 2 + #880 can deploy continuously; only H3b needs
deployment attention. H3c is mechanical deletion of code already
proven dead by H3b's tests.

### Trade-offs you are accepting

- **Transient duplication.** Between R5 and R7, the application
  services exist alongside the inline logic in `main.py`. This is
  intentional — it is what lets each PR branch from `main`.
- **More git operations.** 12 PRs instead of 5. Mitigated by the
  fact that R1–R4 are parallel and each PR is shorter to open.
- **Re-export shims live briefly.** During H2, the Avalara domain
  files become one-line re-exports from `core/domains/tax/`. Those
  shims are deleted in a small cleanup PR after H3 (included in the
  H3 scope or a trivial H3.1).
- **R5 is still ~1,800 lines.** Three application services + their
  tests are hard to split further without fragmenting a use case
  across PRs. If R5 is still too big on the day, split by use case:
  R5a = estimate + create, R5b = update + credit-note + address.

### Why this beats the earlier "land PR #820 first" plan

- **No single 13k-line review.** The earlier plan assumed PR #820
  was reviewable; it isn't.
- **Parallelism.** R1–R4 are parallel; the earlier plan was strictly
  serial.
- **Revert safety.** Each small PR is cheap to revert. A 13k-line PR
  is effectively un-revertable once merged.
- **Progressive behaviour gating.** Behaviour changes land only at
  R6 (new endpoints) and R7 (legacy rewrite). R1–R5 are
  behaviour-preserving even though they add a lot of code.

## Deliberate divergence from the house pattern

The existing `BaseCustomerExporter` style uses `app/<domain>/schema.py`
HTTP schemas directly as the plugin contract — it is **not** hex. That
works for the other domains because each has a single thick plugin and
no need for provider-neutral rules.

Tax is different on **two axes**:

1. **Multiple tax-engine providers**: Avalara today, Anrok next, likely
   a third after that — calls for a shared domain + port
   (`BaseTaxHandler`).
2. **Multiple ERP tax-code adapters**: every accounting connector
   (NetSuite, Xero, QB, Zoho, …) carries a tax-rate-catalog concept,
   currently expressed as ad-hoc `get_tax_rates` / `create_tax_rate`
   methods on each plugin — calls for a separate role-specific port
   (`TaxRateCatalogPort`).

We want a richer structure for tax only, knowing it introduces a
second convention in the codebase. That is an accepted trade-off
for this proposal. The two-ports decomposition (one per aggregate
root) is the price of keeping `@abstractmethod` enforcement honest
across both roles — see "Why two ports rather than one combined ABC"
in section 2 for the full rationale.

## Proposed structure

### 1. New: shared tax domain layer — `core/domains/tax/`

```
core/domains/
└── tax/                              NEW
    ├── __init__.py
    ├── models.py                     TaxDocument, TaxQuote, TaxLine, Address,
    │                                 Customer, CreditNote — hoisted from
    │                                 connectors/avalara/domain/models.py
    ├── value_objects.py              CurrencyCode, CountryCode
    ├── exceptions.py                 TaxConnectorError hierarchy
    │                                 (TaxCalculationError,
    │                                 TaxCalculationUpstreamError,
    │                                 InvalidAddressError, CredentialsError,
    │                                 DuplicateInvoiceError, …) —
    │                                 neutral base; plain Exception,
    │                                 no HTTP code on the class.
    │                                 Wire codes become TAX_*.
    └── policies/                     provider-neutral business rules
        ├── __init__.py
        ├── exemption.py              hoisted from avalara/policies/
        ├── rounding.py
        └── currency_normalization.py
```

Why `core/domains/` and not `app/tax/domain/`: the domain layer is
provider-neutral and is consumed by connectors living **outside**
`app/`. Putting it under `app/tax/` would force connectors to
import upward from `connectors/` into `app/`, which is the dependency
inversion we're trying to avoid.

### 2. New: ports — `BaseTaxHandler` + `TaxRateCatalogPort`

Both ports live alongside the other `Base*Exporter` ABCs in
`core/plugin/handlers/`. Unlike them, they speak **domain types** from
`core/domains/tax/`, not HTTP schemas. The tax domain has **two
role-specific ports**, separated by aggregate root: tax assessment vs.
ERP tax-rate-catalog CRUD.

#### 2a. `BaseTaxHandler` (H1, merged) — driving port for tax-engine adapters (calc trio)

Implemented by tax-engine adapters: Avalara today, Anrok next.

```python
from abc import ABC, abstractmethod
from core.domains.tax.models import (
    EnrichmentContext, Refund, TaxDocument, TaxQuote,
)


class BaseTaxHandler(ABC):
    """Port every tax-engine adapter must implement."""

    @abstractmethod
    async def estimate_tax(
        self, document: TaxDocument, context: EnrichmentContext,
        amount_before_tax: Decimal,
    ) -> TaxQuote: ...

    @abstractmethod
    async def create_tax(
        self, document: TaxDocument, context: EnrichmentContext,
        invoice_id: str,
    ) -> TaxQuote: ...

    @abstractmethod
    async def report_credit_note(self, refund: Refund) -> TaxQuote: ...
```

This is the calc seam. Both Avalara and (future) Anrok implement this
interface.

#### 2b. `TaxRateCatalogPort` (#880, open) — driving port for ERP tax-rate-catalog adapters

Implemented by ERP adapters that expose their tax-code reference data:
NetSuite next, then Xero, QB, Zoho. Wired into `AccountingPlugin` via
the `tax_rate_catalog_class` slot — adapters mix in by _setting the
slot_ rather than by inheritance, so an `AccountingPlugin` doesn't have
to be a `TaxRateCatalogPort` itself.

```python
from abc import ABC, abstractmethod
from core.domains.tax.value_objects import ErpTaxCode


class TaxRateCatalogPort(ABC):
    """Port every ERP tax-rate-catalog adapter must implement."""

    @abstractmethod
    async def list_tax_rates(self, ...) -> list[ErpTaxCode]: ...

    @abstractmethod
    async def get_tax_rate_by_id(self, tax_rate_id: str) -> ErpTaxCode: ...

    @abstractmethod
    async def create_tax_rate(self, code: ErpTaxCode) -> ErpTaxCode: ...
```

This is the catalog seam. The `AccountingPlugin` facades
(`get_tax_rates` / `get_tax_rate_by_id` / `create_tax_rate`) delegate
to the catalog adapter when the slot is set, otherwise preserve
`NotImplementedError`.

#### Why two ports rather than one combined ABC

Tax assessment (calc trio) and ERP tax-code CRUD operate on **different
aggregate roots** — a tax transaction vs. tax-rate reference data —
with different lifecycles and different application-service consumers.
Folding both onto one ABC would mean every adapter declares methods it
doesn't fulfil and the type system stops enforcing role compliance.
Two single-role ports keep `@abstractmethod` honest: tax-engine
adapters mix in `BaseTaxHandler`; AccountingPlugin adapters set
`tax_rate_catalog_class` to a `TaxRateCatalogPort`.

### 3. Existing externally: `app/tax/` — gains one mapper file

```
app/tax/
├── schema.py                         UNCHANGED — HTTP wire schemas
├── service.py                        UNCHANGED interface; body now:
│                                       1. HTTP schema → TaxDocument
│                                       2. call BaseTaxHandler port
│                                       3. TaxQuote → response dict
└── mappers.py                        NEW — HTTP ⇄ core.domains.tax mappers
```

- `api/tax.py` — untouched. Same routes, same request/response shapes.
- `app/tax/service.py` — the public method signatures and return types
  stay identical, so route handlers don't change. Internally, it now
  converts once at the boundary, calls the port, converts the domain
  result back to a dict. The existing ad-hoc `**request.dict()` splats
  disappear.

### 4. Existing: `connectors/avalara/` — cleanup after hoist

```
connectors/avalara/
├── main.py                           MODIFIED — declares
│                                       class AvalaraTaxPlugin(BaseTaxHandler)
├── domain/                           DELETED — moved to core/domains/tax/
├── application/                      UNCHANGED shape; services now
│                                       receive TaxDocument, not
│                                       request dicts
├── infrastructure/                   UNCHANGED — AvaTaxGateway,
│                                       error_translator
├── mappers/                          UNCHANGED role — map
│                                       TaxDocument ⇄ Avalara vendor
│                                       schemas
├── policies/                         SPLIT — provider-neutral ones
│                                       (exemption, rounding, currency
│                                       normalization) moved up to
│                                       core/domains/tax/policies/;
│                                       only Avalara-specific ones
│                                       (e.g. reporting_currency_policy)
│                                       stay local
└── schemas/                          UNCHANGED — Avalara wire schemas
```

### 5. New plugin: `connectors/anrok/`

Mirror-image of the Avalara layout. Reuses the shared domain; adds
nothing to `core/` or `app/`.

```
connectors/anrok/
├── __init__.py
├── main.py                           class AnrokTaxPlugin(BaseTaxHandler)
├── application/
│   ├── estimate_tax_service.py
│   ├── create_invoice_tax_service.py
│   ├── update_invoice_tax_service.py
│   ├── report_credit_note_service.py
│   └── validate_address_service.py
├── infrastructure/
│   ├── anrok_gateway.py              wraps Anrok HTTP client / SDK
│   └── error_translator.py           Anrok errors →
│                                       core.domains.tax.exceptions
├── mappers/
│   ├── tax_document_mapper.py        TaxDocument ⇄ Anrok request
│   └── tax_quote_mapper.py           Anrok response ⇄ TaxQuote
├── schemas/
│   ├── requests.py                   Anrok wire schemas (Pydantic)
│   └── responses.py
└── policies/                         Anrok-specific only (if any)
```

Anrok never redefines `TaxDocument`, `TaxQuote`, or any shared policy —
it imports them from `core.domains.tax`. Registration is identical to
other connectors: one entry in the plugin registry resolved by name
via [core/plugin/engine.py](core/plugin/engine.py).

## End-to-end flow for Anrok `POST /tax/create`

```
api/tax.py
  └─ TaxService.create_sales_tax(request: SalesTaxDocumentRequestSchema)
       │
app/tax/service.py
  ├─ mappers.request_to_tax_document(request)  → TaxDocument
  ├─ handler = PluginEngine.get_plugin_instance("anrok")
  │    # typed as BaseTaxHandler
  ├─ quote: TaxQuote = await handler.create_tax(doc)
  └─ return mappers.tax_quote_to_response(quote)
       │
─────── port boundary (BaseTaxHandler) ───────
connectors/anrok/main.py
  └─ AnrokTaxPlugin.create_tax(doc: TaxDocument)
       └─ application/create_invoice_tax_service.py
            ├─ apply core.domains.tax.policies.exemption(doc)
            ├─ apply core.domains.tax.policies.rounding(doc)
            ├─ mappers.tax_document_to_anrok_request(doc)
            ├─ await anrok_gateway.create_transaction(req)
            ├─ error_translator on any AnrokApiError → TaxDomainError
            └─ mappers.anrok_response_to_tax_quote(resp) → TaxQuote
```

Key invariants:

- The app layer never imports anything from `connectors/anrok/` or
  `connectors/avalara/`.
- Plugins never import from `app/tax/`.
- The only types crossing the port are those in `core/domains/tax/`.

## Files to create / modify / delete

**Create (scaffolding the hex):**

- [core/domains/tax/**init**.py](core/domains/tax/__init__.py)
- [core/domains/tax/models.py](core/domains/tax/models.py) — hoist from
  [connectors/avalara/domain/models.py](connectors/avalara/domain/models.py)
- [core/domains/tax/value_objects.py](core/domains/tax/value_objects.py)
- [core/domains/tax/exceptions.py](core/domains/tax/exceptions.py) —
  hoist from
  [connectors/avalara/domain/exceptions.py](connectors/avalara/domain/exceptions.py)
- [core/domains/tax/policies/](core/domains/tax/policies/) —
  `exemption.py`, `rounding.py`, `currency_normalization.py` from
  [connectors/avalara/policies/](connectors/avalara/policies/)
- [core/plugin/handlers/base_tax_handler.py](core/plugin/handlers/base_tax_handler.py)
- [app/tax/mappers.py](app/tax/mappers.py)

**Modify:**

- [app/tax/service.py](app/tax/service.py) — type hints reference
  `BaseTaxHandler`; each method calls mapper → port → mapper
- [connectors/avalara/main.py](connectors/avalara/main.py) — declares
  `class AvalaraTaxPlugin(BaseTaxHandler)`; updates imports from
  `.domain` to `core.domains.tax`
- [connectors/avalara/application/\*.py](connectors/avalara/application/)
  — signatures accept `TaxDocument`, not request dicts
- [connectors/avalara/mappers/\*.py](connectors/avalara/mappers/) —
  re-import domain types from `core.domains.tax`

**Delete (after move):**

- [connectors/avalara/domain/](connectors/avalara/domain/)
- provider-neutral files in
  [connectors/avalara/policies/](connectors/avalara/policies/)

**Untouched:**

- [api/tax.py](api/tax.py), [app/tax/schema.py](app/tax/schema.py) —
  backward-compatible HTTP surface.
- All other domain folders (`app/customers/`, `app/invoices/`,
  `app/payments/`, `app/connectors/` etc.) — stay on the existing
  `schema.py + service.py` + `Base*Exporter(ABC)` pattern.
- `core/utils/tax/` regional configs — referenced from
  `core/domains/tax/policies/` but not moved (separate cleanup).

## Anrok — where a new plugin plugs in

For a from-scratch Anrok integration, only `connectors/anrok/` is new.
No change to `core/`, `app/tax/`, or `api/`. The plugin engine already
resolves by `connector_name` and will pick up Anrok once registered.

Minimum viable Anrok skeleton to get type-checking green:

1. [connectors/anrok/main.py](connectors/anrok/main.py) —
   `class AnrokTaxPlugin(BaseTaxHandler)` with five stubs that
   raise `NotImplementedError`.
2. Register in the plugin registry (same mechanism Avalara uses).
3. Flesh out `application/`, `infrastructure/`, `mappers/`, `schemas/`
   methods one at a time; tests can exercise each use-case service in
   isolation against a `FakeAnrokGateway`.

Order suggestion:

1. `estimate_tax` — simplest, no persistence.
2. `create_tax` — add idempotency + commit.
3. `report_credit_note` — often vendor-specific quirks.

## Testing strategy

The hex restructure changes **where seams live**, which means it also
changes **what each test level is responsible for**. The goal is a
test pyramid that mirrors the architecture: fast pure tests at the
bottom, plugin-specific integration in the middle, one skinny E2E
layer at the top — plus a new cross-plugin **contract** tier that
does not exist today.

```
           ┌──────────┐
           │   E2E    │   FastAPI TestClient, one per HTTP route
           └──────────┘
         ┌──────────────┐
         │   Contract   │   Same suite runs against every plugin
         └──────────────┘
       ┌──────────────────┐
       │   Integration    │   Plugin internals + mocked vendor SDK
       └──────────────────┘
     ┌──────────────────────┐
     │        Unit          │   Pure domain, mappers, app.service
     └──────────────────────┘
```

### 1. Unit tests for the shared domain — `tests/core/domains/tax/`

The domain layer is pure and has no I/O, so it gets the fastest,
most exhaustive coverage.

- `test_models.py` — Pydantic validators on `TaxDocument`,
  `TaxQuote`, `Address`: empty-lines rejection, currency-code
  normalization, jurisdiction invariants.
- `test_value_objects.py` — `CurrencyCode`, `CountryCode` enum
  round-trips and illegal-value rejection.
- `test_policies_*.py` — one file per policy
  (`exemption`, `rounding`, `currency_normalization`). Input: a
  `TaxDocument`; output: a mutated/new `TaxDocument`. No fakes
  needed.

These tests replace the scattered policy tests currently living
under [tests/connectors/avalara/policies/](tests/connectors/avalara/policies/).
Move them up with the code.

### 2. Unit tests for mappers — `tests/app/tax/test_mappers.py`

Round-trip HTTP ↔ domain with a table of fixtures:

- `SalesTaxDocumentRequestSchema` → `TaxDocument` → canonical dict
- `TaxQuote` → response dict — shape-stable for the frontend
  contract
- Negative cases: missing required field raises a typed
  `ValidationError`, not a generic `KeyError`.

### 3. Unit tests for the application service — `tests/app/tax/test_service.py`

`TaxService` becomes trivially testable once it depends on
`BaseTaxHandler` instead of the plugin engine. Inject a
**FakeTaxHandler** (see below) and assert:

- Happy path: service calls mapper → handler → mapper in that
  order.
- Error translation: handler raises `TaxDomainError`; service
  raises `TaxCalculationError`.
- `PluginNotSetupException` still fires when the plugin engine
  returns nothing.
- Credit-note response persistence still writes one history row
  per element.

No `PluginEngine`, no DB, no HTTP — sub-second tests.

### 4. NEW: contract tests — `tests/tax/contracts/`

The single most valuable test tier the hex refactor unlocks. One
reusable suite that **every** plugin must pass:

```
tests/tax/contracts/
├── conftest.py                    exposes a `plugin` fixture,
│                                    parametrized across
│                                    [AvalaraTaxPlugin,
│                                     AnrokTaxPlugin]
│                                    each wired to its own fake
│                                    gateway
├── test_estimate_contract.py      BaseTaxHandler.estimate_tax
├── test_create_contract.py
├── test_update_contract.py
├── test_credit_note_contract.py
└── test_validate_address_contract.py
```

Each test feeds a canonical `TaxDocument` fixture and asserts
invariants that hold regardless of provider:

- Returned `TaxQuote.currency` matches input.
- `TaxQuote.total_tax >= 0`.
- Line count matches input.
- Jurisdiction fields populated.
- Idempotent: calling `create_tax` twice with same
  `invoice_id` returns the same transaction code.
- Errors map cleanly: fake gateway raises a vendor error →
  handler surfaces it as a `TaxDomainError` subtype, never leaks
  the vendor exception type.

This is where plugin drift gets caught before production. Today
this tier does not exist because the two plugins don't share a
contract.

### 5. Plugin-internal integration tests — `tests/connectors/<plugin>/`

Keep the existing Avalara test layout; replicate it for Anrok. The
seam to mock is the **gateway**, not the vendor SDK directly.

```
tests/connectors/avalara/
├── application/                   receives TaxDocument, returns TaxQuote
├── mappers/                       TaxDocument ⇄ Avalara wire schemas
├── infrastructure/                AvaTaxGateway with mocked SDK
│                                    (existing pattern)
└── fakes/
    └── fake_avatax_gateway.py     in-memory gateway used by
                                    contract tests and
                                    application tests
```

Application-service tests (e.g.
`create_invoice_tax_service_test.py`) get simpler: they take a
`TaxDocument`, not a raw request dict, and assert on a `TaxQuote`.

### 6. End-to-end tests — `tests/api/test_tax_routes.py`

One test per HTTP route, driven by FastAPI `TestClient`. The
plugin engine is patched to return a `FakeTaxHandler` so the E2E
layer proves the **wiring**, not the plugin:

- Route accepts the documented request shape.
- Response schema matches the documented response shape.
- Known error path returns the right HTTP status + body shape.

These tests must be cheap — they exist to catch broken wiring
between `api/` and `app/`, not to re-test plugin logic.

### 7. Shared test doubles — `tests/tax/fakes/` and `tests/tax/builders/`

Put these once, use everywhere:

- `FakeTaxHandler(BaseTaxHandler)` — canned `TaxQuote` response
  - knobs to make methods raise specific `TaxDomainError`
    subtypes. Used by `test_service.py` and `test_tax_routes.py`.
- `FakeAvaTaxGateway`, `FakeAnrokGateway` — in-memory gateways
  implementing the vendor-gateway protocol. Used by application
  tests and the contract tier.
- `tax_document_builder(**overrides)`,
  `tax_quote_builder(**overrides)` — keep tests tight; avoid
  50-line object literals.

### Migration of existing tests

- [tests/connectors/avalara/domain/](tests/connectors/avalara/domain/)
  → [tests/core/domains/tax/](tests/core/domains/tax/) — rename,
  update imports; assertions unchanged.
- [tests/connectors/avalara/policies/](tests/connectors/avalara/policies/)
  — provider-neutral tests move up;
  Avalara-specific ones stay.
- Existing application-service tests keep their location; update
  fixtures to construct `TaxDocument` instead of request dicts.
- Add a thin adaptation layer in `conftest.py` so the old `**dict`
  fixtures still build valid `TaxDocument`s during the transition
  — lets the refactor land in two PRs (move + switch call sites)
  without a giant red suite in between.

### When each tier ships

Tests are **not** a separate rollout stage — they land with the code
that makes them meaningful. The only tier that needs special
handling is the contract tier (new to this codebase), which arrives
with the port in H1 and expands automatically when each new plugin
declares conformance.

| Test tier                                                          | Lands in                                                                                                                           | Rationale                                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Unit — domain models, policies, mappers                            | Same PR as the unit (R1, R2, R4, H2)                                                                                               | Self-verifying; reviewer uses tests as the spec                      |
| Integration — gateway + fakes, service + fake-gateway              | Same PR as the collaborator pair (R3 for gateway + fakes; R5 for application-service + fake-gateway)                               | Fakes are test infrastructure — they arrive when the real thing does |
| Contract — parametrized over every `BaseTaxHandler` implementation | **H1** (initial scaffold + Avalara parametrization); expands **automatically** at H4 when Anrok is added — no new test code needed | Forces plugin conformance; catches drift in CI before review         |
| E2E — FastAPI `TestClient` against HTTP routes                     | R6 for new routes (happy + one error per route); H3 for HTTP↔domain mapper cases                                                   | One test per route as wiring-proof; not a substitute for lower tiers |
| Legacy-test cleanup (deletions)                                    | R7 — same PR that retires the code they covered                                                                                    | Keeps the `git log` honest: same commit removes code and its test    |

Narrow-scope test-only PRs (`R8`) are the exception, not the rule,
and exist only for **cross-cutting** infrastructure that has no
natural home in a code PR — import-hygiene lint, shared
`tests/_support/builders/`, contract-test skeleton if it didn't fit
in H1. If those items distribute naturally, **drop R8** and the plan
is 11 PRs.

### Coverage gates

- Shared domain + mappers: 100% line coverage target — they are
  pure and cheap.
- Contract tier: every method on `BaseTaxHandler` exercised by at
  least one contract test, parametrized across all registered
  plugins.
- E2E: one happy path + one error path per route. Nothing more —
  plugin logic lives in the lower tiers.

### What this gives you

- **Add Anrok with confidence.** The contract tier tells you when
  Anrok is behaviourally equivalent to Avalara.
- **Fast feedback loop.** Domain and mapper tests run in
  milliseconds without touching the plugin engine.
- **Drift prevention.** The port is an ABC, the contract suite is
  parametric — a plugin that skips a method fails collection, a
  plugin that lies about invariants fails the contract test.

## Error handling

### Current state (after `f1d8048e simplfying error handling`)

`TaxConnectorError` inherits from `CustomException` so the FastAPI
handler at [app/server.py:102](app/server.py:102) serialises any
subclass directly to `{error_code, message}` with `exc.code` as HTTP
status. This collapses the plan's original two-layer taxonomy (domain
→ HTTP with a translate step in `app/tax/service.py`) into a single
hierarchy — fewer hops, but the "domain" class carries HTTP-shaped
state (`code`, wire `error_code`), which is a known debt against the
hex rule "`core/domains/tax/` must not depend on transport".

This debt is deliberate for now. It gets paid off in H2b when the
base class hoists to `core/domains/tax/exceptions.py` and the wire
codes / message templates are neutralized in the same PR (the
downstream-consumer audit below cleared both moves).

### Target state after H2b (hex-clean, no translate-step noise)

- Domain base (`TaxConnectorError` → renamed to carry neutral
  semantics at core, adapter-specific subclasses stay under
  `connectors/avalara/`) drops the `code` class attribute and
  inherits from plain `Exception`.
- HTTP-status mapping lives in a single class→status registry
  (~20 lines) consulted by the FastAPI exception handler. No
  per-call-site `_translate_domain_error` helper.
- Subclasses keep `error_code` and `message_template`. Wire codes
  become `TAX_*` at core (e.g. `TAX_INVALID_ADDRESS`,
  `TAX_CALCULATION_ERROR`, `TAX_CREDENTIALS_INVALID`); message
  templates strip "Avalara" wording and become provider-neutral
  ("A tax provider error occurred", "Could not calculate tax for this
  transaction", "Tax provider credentials are missing or invalid —
  reconnect in settings"). Avalara-adapter-specific subclasses _may_
  override with `AVALARA_*` codes / Avalara-flavoured copy where the
  UX benefits, but the **default is neutral**.
- `app/tax/service.py` never catches and translates — catch happens
  only where business dispatch requires it (gateway retry, idempotency
  short-circuit). Unhandled errors fall through to the FastAPI
  handler unchanged.

### Downstream-consumer audit (2026-05-03)

Before committing to the wire-code rename in H2b, both downstream
consumers of these error codes were audited:

- **Frontend** (`bhaveshdarpan/frontend`): zero matches for `AVALARA_*`
  or `INVALID_ADDRESS_FOR_SALES_TAX` as string literals across `src/`
  and `cypress/`. Errors are read generically via
  [`src/utils/kyApiInstance.ts:62`](https://github.com/.../kyApiInstance.ts#L62)
  which copies `error_code` onto the error object, and
  [`src/utils/error.ts`](https://github.com/.../error.ts) displays
  the backend `message` verbatim. Only 3 places anywhere in the
  frontend switch on `error_code` (`VALIDATION_ERROR`,
  `INVOICE_NOT_DUE`) — none related to tax. **Verdict: rename safe.**
- **Backend** (`bhaveshdarpan/backend`): zero matches for `AVALARA_*`
  in dispatch / switch / registry logic.
  [`core/connector_client/connectory.py`](core/connector_client/connectory.py)
  switches on `error_code` only for STRIPE codes. The
  `connector_request_wrapper.SPECIAL_ERROR_CODES` dispatch dict
  contains only `RESOURCE_MAPPING_NOT_FOUND` and
  `STRIPE_INVALID_REFRENCE_KEY`. Retry middleware
  ([`core/exceptions/retry.py`](core/exceptions/retry.py)) keys on
  HTTP status only. **Verdict: rename safe.**

The legacy comments in [connectors/avalara/domain/exceptions.py:111](connectors/avalara/domain/exceptions.py#L111)
(`AddressParseError` claiming "backend dispatch rules tied to that code")
and [exceptions.py:172](connectors/avalara/domain/exceptions.py#L172)
(`RefundError` claiming "backend error registry" entries) are
**unverified by code inspection** — those dependencies do not exist
in the backend. The cautious comments can be deleted in H2b along
with the rename.

The remaining unknown is observability (Sentry / Datadog saved
queries keyed on the literal codes). These break silently — no test
catches them. Confirm with on-call before H2b merges, then ship.

### Error taxonomy

Class names stay; wire codes change in H2b. The "before" column is
what currently ships on `main` in [connectors/avalara/domain/exceptions.py](connectors/avalara/domain/exceptions.py);
the "after" column is what H2b lands at `core/domains/tax/exceptions.py`.

| Class                         | HTTP | `error_code` before (current)           | `error_code` after (H2b)           |
| ----------------------------- | ---: | --------------------------------------- | ---------------------------------- |
| `InvalidAddressError`         |  400 | `AVALARA_INVALID_ADDRESS`               | `TAX_INVALID_ADDRESS`              |
| `AddressParseError`           |  400 | `INVALID_ADDRESS_FOR_SALES_TAX`         | `TAX_ADDRESS_PARSE_ERROR`          |
| `TaxCalculationError`         |  400 | `AVALARA_TAX_CALCULATION_ERROR`         | `TAX_CALCULATION_ERROR`            |
| `TaxCalculationUpstreamError` |  502 | `AVALARA_TAX_CALC_UPSTREAM_UNAVAILABLE` | `TAX_UPSTREAM_UNAVAILABLE`         |
| `CredentialsError`            |  401 | `AVALARA_CREDENTIALS_INVALID`           | `TAX_CREDENTIALS_INVALID`          |
| `UnsupportedCountryError`     |  400 | `AVALARA_UNSUPPORTED_COUNTRY`           | `TAX_UNSUPPORTED_COUNTRY`          |
| `RefundError`                 |  400 | `AVALARA_REFUND_FAILED`                 | `TAX_REFUND_FAILED`                |
| `DuplicateInvoiceError`       |  409 | `AVALARA_DUPLICATE_INVOICE`             | `TAX_DUPLICATE_INVOICE`            |
| `MappingLookupError`          |  500 | `AVALARA_MAPPING_LOOKUP_FAILED`         | `TAX_MAPPING_LOOKUP_FAILED`        |
| `TaxConfigurationError`       |  400 | `AVALARA_TAX_CONFIG_MISSING`            | `TAX_CONFIG_MISSING`               |
| `CurrencyConversionError`     |  502 | `AVALARA_CURRENCY_CONVERSION_FAILED`    | `TAX_CURRENCY_CONVERSION_FAILED`   |
| `DiscountDistributionError`   |  400 | `AVALARA_DISCOUNT_DISTRIBUTION_FAILED`  | `TAX_DISCOUNT_DISTRIBUTION_FAILED` |

Avalara-only failure modes (if any surface in the future that don't
make sense as neutral concepts) get their own subclasses under
`connectors/avalara/exceptions.py` with `AVALARA_*` codes.

Note on `IdempotencyConflictError`: the original plan listed this as
a domain error. In the code, idempotency is a **success** short-circuit
— `create_invoice_tax_service` checks `connector_mapping` first and
returns the prior `TaxQuote`. `DuplicateInvoiceError` only fires when
the vendor itself rejects a duplicate that slipped past the lookup.
`IdempotencyConflictError` is removed from the taxonomy.

### Error flow (current and target)

```
Vendor SDK / HTTP error
    │
    ▼  gateway (connectors/<p>/infrastructure/*_gateway.py)
error_translator.to_domain_error(exc)
    ├─ retry inside gateway on transient classes
    │   (TaxCalculationUpstreamError pre-retries)
    └─ raises TaxConnectorError subclass
    │
    ▼  application service (connectors/<p>/application/*.py)
may catch specific subclass for business dispatch
(e.g. short-circuit on DuplicateInvoiceError) — otherwise propagates
    │
    ▼  plugin main (connectors/<p>/main.py) — no try/except
    │
    ▼  app/tax/service.py — no translate-step; propagates
    │
    ▼  api/tax.py — no handler code; propagates
    │
    ▼  app/server.py — @app.exception_handler(CustomException)
serialises {code, error_code, message}
```

### Context contract per error class (lands in R2)

Each subclass declares a typed `__init__` listing its required
context keys. `_MissingKeyDict`, `_safe_format`, and the `try/except`
around `format_map` are removed — a raise site that omits a key is
a bug, and `format_map` on a plain dict will raise `KeyError` at the
raise site so unit tests catch the omission instead of shipping
blank-slot messages in prod. Templates with no placeholders stay
trivially safe.

Example:

```python
class UnsupportedCountryError(TaxConnectorError):
    error_code = "TAX_UNSUPPORTED_COUNTRY"
    message_template = "Tax calculation is not supported for {country}."

    def __init__(
        self,
        *,
        country: str,
        operation: str | None = None,
        provider_error: BaseModel | None = None,
        cause: Exception | None = None,
    ):
        super().__init__(
            context={"country": country},
            operation=operation,
            provider_error=provider_error,
            cause=cause,
        )
```

Tests that pin the old soft-fail behaviour
(`test_template_tolerates_missing_context_keys`) flip to
`test_template_requires_context_keys` and assert `KeyError`.

### Invariants

1. **Vendor exception types never escape the gateway.** Anything
   caught from the SDK/HTTP client is immediately re-raised as a
   `TaxConnectorError` subclass.
2. **No `except Exception` above the gateway.** Every catch names a
   specific subclass. Bare `except` is a code-review red flag in
   tax/.
3. **No HTTP translate-step in `app/tax/service.py`.** The FastAPI
   `CustomException` handler serialises directly.
4. **Typed raise sites.** Each subclass's required context keys are
   kwargs on its `__init__`. No free-form `context={...}` blobs at
   raise sites.
5. **Retry hints ride on exception type.** Backend's retry middleware
   branches on the HTTP status that comes from the class's `code`
   attribute (today) or the class→status registry (after H2); callers
   that want to retry check `isinstance`, not substring-match.
6. **Idempotency is not an error.** Mapping-lookup short-circuit is
   a success path; `DuplicateInvoiceError` is the race-loss fallback.

### Gateway-level concerns

- `error_translator.py` per plugin owns the vendor → domain mapping.
  Pure function — unit-testable with captured vendor responses.
- Retries on transient errors happen **inside the gateway**, not in
  the application service. Backoff is per-plugin because each vendor
  has its own rate-limit behaviour. Not yet implemented on the
  Avalara branch; `TaxCalculationUpstreamError` surfaces 502 to
  backend's retry middleware as the interim mechanism.
- Structured logging at the translate-site: log the original vendor
  error once with full context (vendor code, HTTP status, correlation
  id), then raise the domain type. No duplicate logging above.

### Behaviour-preserving notes

- `report_credit_note` today re-raises bare `Exception`; the refactor
  narrows that to `TaxConnectorError`. FastAPI still produces a 500
  for anything unhandled — the observable change is typed catch at
  the caller.
- `commit_tax` swallows failures and returns a synthetic
  `{"status": "TAX CALCULATION ERROR", ...}` dict. Preserve verbatim
  — this is an active code path, not deprecated.

## Typing per layer

Explicit types at every boundary are the tool that makes the port
contract enforceable. The table below shows the in/out type of each
layer after the refactor; every row is a type the static checker can
verify.

| Layer                      | Location                                                                             | Input type                                                                                            | Output type                               |
| -------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| HTTP request               | client                                                                               | JSON body                                                                                             | —                                         |
| Controller                 | [api/tax.py](api/tax.py)                                                             | FastAPI-parsed `SalesTaxDocumentRequestSchema` (etc.) + `organisation: UUID` + `entity: UUID \| None` | `dict` (JSON-serializable)                |
| Application service        | [app/tax/service.py](app/tax/service.py)                                             | `SalesTaxDocumentRequestSchema` (same as route)                                                       | `dict`                                    |
| HTTP ⇄ domain mapper       | [app/tax/mappers.py](app/tax/mappers.py)                                             | `SalesTaxDocumentRequestSchema` → `TaxDocument`; `TaxQuote` → `dict`                                  | (see input)                               |
| Port (plugin boundary)     | [core/plugin/handlers/base_tax_handler.py](core/plugin/handlers/base_tax_handler.py) | `TaxDocument` / `CreditNote` / `Address`                                                              | `TaxQuote` / `list[TaxQuote]` / `Address` |
| Plugin entry               | `connectors/<p>/main.py`                                                             | `TaxDocument` (etc.)                                                                                  | `TaxQuote` (etc.)                         |
| Plugin application service | `connectors/<p>/application/*.py`                                                    | `TaxDocument`                                                                                         | `TaxQuote`                                |
| Domain ⇄ vendor mapper     | `connectors/<p>/mappers/*.py`                                                        | `TaxDocument` → `<VendorRequestModel>`; `<VendorResponseModel>` → `TaxQuote`                          | (see input)                               |
| Gateway                    | `connectors/<p>/infrastructure/*_gateway.py`                                         | `<VendorRequestModel>` (Pydantic)                                                                     | `<VendorResponseModel>` (Pydantic)        |
| Vendor SDK/HTTP            | external                                                                             | vendor-native JSON / SDK object                                                                       | vendor-native JSON / SDK object           |

### Concrete signatures

Controller — [api/tax.py](api/tax.py):

```python
@tax_router.post("/create")
async def create_sales_tax(
    request: SalesTaxDocumentRequestSchema,
    organisation: UUID = Header(),
    entity: Optional[UUID] = Header(default=None),
) -> Dict:
    return await TaxService().create_sales_tax(
        request=request, organisation=organisation, entity=entity,
    )
```

Application service — [app/tax/service.py](app/tax/service.py):

```python
async def create_sales_tax(
    self,
    request: SalesTaxDocumentRequestSchema,
    organisation: UUID,
    entity: Optional[UUID] = None,
) -> dict:
    doc: TaxDocument = mappers.request_to_tax_document(request)
    handler: BaseTaxHandler = await self._plugin_engine.get_plugin_instance(
        connector_name=request.connector.name.lower(),
        organisation=organisation,
        entity=entity,
    )
    try:
        quote: TaxQuote = await handler.create_tax(doc)
    except TaxDomainError as exc:
        raise self._translate_domain_error(exc)
    return mappers.tax_quote_to_response(quote)
```

HTTP ⇄ domain mappers — [app/tax/mappers.py](app/tax/mappers.py):

```python
def request_to_tax_document(
    request: SalesTaxDocumentRequestSchema,
) -> TaxDocument: ...

def tax_quote_to_response(quote: TaxQuote) -> dict: ...

def address_request_to_address(
    request: ValidateAddressRequestSchema,
) -> Address: ...

def address_to_response(address: Address) -> dict: ...
```

Port — [core/plugin/handlers/base_tax_handler.py](core/plugin/handlers/base_tax_handler.py):

```python
class BaseTaxHandler(ABC):
    @abstractmethod
    async def estimate_tax(
        self, document: TaxDocument, context: EnrichmentContext,
        amount_before_tax: Decimal,
    ) -> TaxQuote: ...

    @abstractmethod
    async def create_tax(
        self, document: TaxDocument, context: EnrichmentContext,
        invoice_id: str,
    ) -> TaxQuote: ...

    @abstractmethod
    async def report_credit_note(self, refund: Refund) -> TaxQuote: ...
```

Plugin application service — example
`connectors/anrok/application/create_invoice_tax_service.py`:

```python
async def create_invoice_tax(
    doc: TaxDocument,
    gateway: AnrokGateway,
    mapping_repo: IdempotencyRepository,
) -> TaxQuote:
    ...
```

Gateway — example `connectors/anrok/infrastructure/anrok_gateway.py`:

```python
class AnrokGateway:
    async def create_transaction(
        self, request: AnrokCreateTransactionRequest,
    ) -> AnrokTransactionResponse: ...

    async def adjust_transaction(
        self, code: str, request: AnrokAdjustRequest,
    ) -> AnrokTransactionResponse: ...

    async def resolve_address(
        self, request: AnrokAddressRequest,
    ) -> AnrokAddressResponse: ...
```

Vendor-wire schemas — `connectors/anrok/schemas/{requests,responses}.py`
— are Pydantic `BaseModel` subclasses. They sit on **one side** of the
plugin boundary only and are never imported by `app/` or by another
plugin.

### Forbidden imports (enforceable in CI with `import-linter`)

- `app/tax/` must not import from `connectors/*`.
- `connectors/<any>/` must not import from `app/tax/`.
- `connectors/<plugin-a>/` must not import from `connectors/<plugin-b>/`.
- `core/domains/tax/` must not import from `app/`, `api/`, or
  `connectors/`.

These rules codify the dependency direction the hex refactor
establishes. A lint rule is cheaper than catching a violation in
review.

## End-state structure

This section captures _what the codebase looks like_ after the H-series
lands — and what shape Anrok takes when H4 eventually ships. It is the
concrete "definition of done" for the refactor.

### After H3b + H3c + #880 (this plan's terminal state)

```
core/
├── domains/
│   └── tax/                                   ← NEW (introduced in H2b)
│       ├── __init__.py
│       ├── models.py                          TaxDocument, TaxQuote, TaxLine,
│       │                                       Address, Customer, CreditNote
│       ├── value_objects.py                   CurrencyCode, CountryCode (H2b),
│       │                                       ErpTaxCode (#880)
│       ├── exceptions.py                      TaxConnectorError hierarchy —
│       │                                       provider-neutral subset
│       └── policies/
│           ├── __init__.py
│           ├── exemption.py                   ← hoisted from avalara (H2b)
│           ├── discount.py                    ← hoisted from avalara (H2b)
│           ├── customer_segmentation.py       ← hoisted from avalara (H2b)
│           ├── rounding.py                    ← lands with first caller
│           └── currency_normalization.py      ← lands with first caller
│
└── plugin/
    └── handlers/
        ├── base_tax_handler.py                ← NEW (H1) — calc port ABC
        │                                        (estimate_tax / create_tax /
        │                                         report_credit_note)
        ├── tax_rate_catalog_port.py           ← NEW (#880) — ERP catalog
        │                                        port ABC (list_tax_rates /
        │                                        get_tax_rate_by_id /
        │                                        create_tax_rate)
        ├── base_customer_exporter.py          (existing, unchanged)
        ├── base_invoice_exporter.py           (existing, unchanged)
        ├── base_payment_exporter.py           (existing, unchanged)
        └── ...

app/
└── tax/
    ├── schema.py                              HTTP wire schemas
    │                                           (CurrencyCode/CountryCode now
    │                                            re-export from core.domains.tax)
    ├── mappers.py                             ← NEW (H3a) — only place the
    │                                           HTTP layer ever produces or
    │                                           consumes a TaxDocument / TaxQuote
    └── service.py                             ← MODIFIED (H3b) — calls
                                                mapper → port → mapper. No more
                                                **request.dict() splats.

api/
└── tax.py                                     UNCHANGED — same routes, same
                                                request/response wire shapes

connectors/
└── avalara/                                   ← MODIFIED (H1, H2b, H3b)
    ├── main.py                                class Avalara(BaseTaxHandler,
    │                                            TaxPlugin) — port-typed
    │                                            methods only; legacy splat
    │                                            methods deleted in H3b
    ├── application/                           UNCHANGED shape — services
    │   ├── tax_calculation_service.py         already accept TaxDocument
    │   ├── legacy_tax_calculation_service.py  (legacy /tax/sales path stays)
    │   ├── credit_note_service.py
    │   ├── address_validation_service.py
    │   ├── credentials_lifecycle_service.py
    │   ├── ports.py                           TaxGatewayPort, IdempotencyPort
    │   └── config.py                          PluginConfig dataclass
    ├── infrastructure/
    │   ├── avatax_client.py                   AvaTax SDK wrapper
    │   ├── credentials_repository.py          Vault access seam
    │   ├── error_translator.py                AvaTax errors →
    │   │                                       core.domains.tax.exceptions
    │   └── operations/                        addresses/, transactions/, utilities/
    ├── mappers/                               domain ↔ Avalara wire schemas
    │   ├── request_mapper.py                  TaxDocument → AvaTax request
    │   ├── response_mapper.py                 AvaTax response → TaxQuote
    │   ├── address_mapper.py
    │   ├── tax_document_mapper.py
    │   ├── tax_response_mapper.py
    │   └── _address_parsing.py
    ├── policies/                              ← REDUCED (H2b moved 3 up)
    │   ├── reporting_currency_policy.py       stays — references
    │   │                                       Avalara EnrichmentContext
    │   └── tax_info_policy.py                 stays — references Avalara enums
    ├── schemas/                               Avalara wire schemas (Pydantic)
    │   ├── transactions.py
    │   ├── addresses.py
    │   ├── enums.py
    │   └── errors.py
    └── domain/                                ← REDUCED to one-line shims (H2b)
        ├── models.py                          `from core.domains.tax.models import *`
        ├── exceptions.py                      Avalara-specific subclasses
        │                                       remain; neutral subset re-exports
        └── enums.py                           Avalara-specific enums remain

tests/
├── core/domains/tax/                          ← NEW (H2b) — pure-domain
│   ├── test_models.py                         unit tests, target 100% line cov
│   ├── test_value_objects.py
│   ├── test_policies_exemption.py
│   ├── test_policies_discount.py
│   ├── test_policies_customer_segmentation.py
│   ├── test_policies_rounding.py
│   └── test_policies_currency_normalization.py
├── tax/contracts/                             ← NEW (H1) — parametrized over
│   ├── conftest.py                            every BaseTaxHandler impl;
│   ├── test_estimate_contract.py              currently [Avalara] only,
│   ├── test_create_contract.py                expands automatically when
│   ├── test_update_contract.py                Anrok lands
│   ├── test_credit_note_contract.py
│   └── test_validate_address_contract.py
├── app/tax/                                   ← NEW (H3a + H3b)
│   ├── test_mappers.py
│   └── test_service.py
└── connector_tests/avalara_tests/             (existing, unchanged shape)
```

**Key invariants enforced by `import-linter` after H1:**

- `app/tax/` ↛ `connectors/*`
- `connectors/avalara/` ↛ `app/tax/`
- `core/domains/tax/` ↛ `app/`, `api/`, `connectors/`

The end-state has **two role-specific ports** (`BaseTaxHandler` for
calc, `TaxRateCatalogPort` for ERP catalog), one shared
domain (`core/domains/tax/`), one HTTP↔domain mapper boundary
(`app/tax/mappers.py`), and one fully hex-shaped adapter
(`connectors/avalara/`). Avalara talks to AvaTax, the application
layer talks to the port, the HTTP layer talks to wire schemas — and
none of them know about each other's types. The catalog side has the port and `ErpTaxCode` value object on this plan's terminal state; concrete catalog adapters (NetSuite, Xero, QB, Zoho on `TaxRateCatalogPort`) are follow-up work and arrive without further core refactoring.

### After H4 (future Anrok plugin)

When Anrok lands, it adds **only `connectors/anrok/`**. Zero changes
to `core/`, `app/`, or `api/` — the architecture from H3b absorbs the
new plugin without further refactoring.

```
connectors/
└── anrok/                                     ← NEW (H4)
    ├── __init__.py
    ├── main.py                                class Anrok(BaseTaxHandler,
    │                                            TaxPlugin) — facade only,
    │                                            5 port methods, ~6 lines each
    ├── exception.py                           thin Anrok-specific subclasses
    │                                           of core.domains.tax.exceptions
    ├── config.json
    ├── config-local.json
    ├── config-staging.json
    ├── config-prod.json
    ├── application/                           use-case services, each
    │   ├── __init__.py                        constructor-injected
    │   ├── ports.py                           AnrokGatewayPort,
    │   │                                       IdempotencyPort Protocols
    │   ├── config.py                          PluginConfig dataclass
    │   ├── estimate_tax_service.py            takes TaxDocument → TaxQuote
    │   ├── create_invoice_tax_service.py
    │   ├── update_invoice_tax_service.py
    │   ├── credit_note_service.py
    │   ├── address_validation_service.py
    │   └── credentials_lifecycle_service.py
    ├── infrastructure/
    │   ├── __init__.py
    │   ├── anrok_client.py                    HTTP client wrapper
    │   ├── credentials_repository.py          Vault access
    │   ├── error_translator.py                Anrok errors →
    │   │                                       core.domains.tax.exceptions
    │   └── operations/
    │       ├── transactions.py                create / adjust calls
    │       └── addresses.py                   resolve / validate calls
    ├── mappers/                               domain ↔ Anrok wire schemas
    │   ├── __init__.py
    │   ├── tax_document_mapper.py             TaxDocument → Anrok request
    │   ├── tax_response_mapper.py             Anrok response → TaxQuote
    │   └── address_mapper.py
    ├── schemas/                               Anrok wire schemas (Pydantic)
    │   ├── __init__.py
    │   ├── requests.py
    │   ├── responses.py
    │   └── errors.py
    └── policies/                              Anrok-specific only, if any
                                                (most rules live in
                                                 core/domains/tax/policies/
                                                 and are reused unchanged)

tests/
├── connector_tests/anrok_tests/               ← NEW (H4)
│   ├── application/                           service-level tests
│   ├── mappers/                               wire-mapping tests
│   ├── infrastructure/                        gateway tests with mocked SDK
│   └── fakes/
│       └── fake_anrok_gateway.py              in-memory gateway used by
│                                               application tests AND by the
│                                               existing tests/tax/contracts/
│                                               suite (Anrok auto-included
│                                               when registered)
└── tax/contracts/                             ← UNCHANGED — the parametrized
                                                contract suite from H1 picks
                                                up Anrok automatically once
                                                AnrokTaxPlugin is registered
```

### What Anrok inherits "for free" from the H-series

Because H1–H3b finish the architectural seam before Anrok arrives,
Anrok's PR is **purely additive** and gets all of the following without
writing any code in `core/` or `app/`:

| Concern                                                                                                                  | Provided by                                     | Anrok's work                                                        |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------- |
| Domain types (`TaxDocument`, `TaxQuote`, `Address`, `CreditNote`)                                                        | `core/domains/tax/models.py` (H2b)              | import them                                                         |
| Value objects (`CurrencyCode`, `CountryCode`)                                                                            | `core/domains/tax/value_objects.py` (H2b)       | import them                                                         |
| Exception base + neutral subclasses                                                                                      | `core/domains/tax/exceptions.py` (H2b)          | subclass for Anrok-specific cases only                              |
| Cross-cutting policies (exemption, discount, segmentation; rounding/currency-normalization land with their first caller) | `core/domains/tax/policies/` (H2b + later)      | call them                                                           |
| Port contract (`BaseTaxHandler` ABC)                                                                                     | `core/plugin/handlers/base_tax_handler.py` (H1) | inherit + implement 5 abstract methods                              |
| HTTP↔domain conversion at the application layer                                                                          | `app/tax/mappers.py` (H3a)                      | nothing — `app/tax/service.py` already speaks domain to all plugins |
| Contract conformance tests                                                                                               | `tests/tax/contracts/` (H1)                     | register Anrok in the parametrize list — one line                   |
| Plugin registration / vault / credentials lifecycle                                                                      | `core/plugin/` + `PluginCore` (existing)        | implement Anrok-specific credentials class                          |

What Anrok **does** still write per-vendor: HTTP client, error
translator, request/response mappers, vendor-wire schemas, application
services that orchestrate them. None of that leaks above the plugin
boundary.

## Non-goals

- No changes to any non-tax domain.
- No change to the HTTP API surface of `api/tax.py`.
- No deprecation of any current tax route. `/tax/sales`, `/tax/commit`,
  and the rest of the existing surface stay live and behaviour-stable
  through the refactor.
- Not introducing dependency-injection framework; the plugin registry
  stays the resolution mechanism, it just returns `BaseTaxHandler`
  instead of an untyped plugin.

## Verification

- Static: `BaseTaxHandler` is an ABC, so any plugin missing a method
  fails at class-definition time. Type-check
  [app/tax/service.py](app/tax/service.py) against the port.
- Behavioural: all existing tests in
  [tests/connectors/avalara/](tests/connectors/avalara/) pass with
  zero change — the hoist is rename-only.
- End-to-end: issue `POST /tax/estimate`, `POST /tax/create`, `POST
/tax/update`, `POST /tax/report_credit_note`,
  `POST /tax/address/validate` against Avalara with a fixture tenant
  — responses identical to pre-refactor.
- Anrok: once the skeleton is in, a second round of the same
  end-to-end suite pointed at `connector=anrok` should exercise the
  stub paths and surface `NotImplementedError` until each method is
  filled.

## Suggested further work

The hex refactor itself is H2b → (H1 + H3a) → H3b → H3c, with #880
running on a parallel track. The items below are adjacent-but-separable
cleanups that the refactor surfaces. Most of the originally-listed
items have shipped or been overtaken by events — the remaining live
items are #0 (`/tax/create` migration), #2 (`import-linter` config),

# 10 (migrate existing AccountingPlugin adapters onto

`TaxRateCatalogPort`), and #11 (retire the `ErpTaxCode.tax_type` ACL
alias). They are listed in the order I'd take them, and none of them
block the H-series.

### 0. `/tax/create` migration — design + backend coordination

The last splat that genuinely matters. After H3b/H3c,
`/tax/create` still calls `Avalara.create_sales_tax(**args)` because
the response is the full Avalara `TransactionModel` envelope
(`status`, `summary[]`, full `lines[]` with details,
`addresses[]`, `messages[]`) that backend's journal-line builder
consumes. The port already exposes `Avalara.create_tax(...) -> TaxQuote`
for adapter-internal use; the HTTP route just doesn't route through
it yet.

What's actually remaining:

1. **Backend audit (read-only).** Grep `bhaveshdarpan/backend` to
   establish which `TransactionModel` fields are actually read.
   `TaxQuote` already covers `transaction_code`, `currency_code`,
   `sales_tax_amount`, `juris_summary` (the cross-line aggregate),
   `line_taxes` (slim per-line). Likely missing fields backend may
   read: `status` ("Saved"/"Committed"), `id`/`type`/`companyId`,
   per-line `details[]` (jurisdiction breakdown), `messages[]`,
   `addresses[]`, `totalAmount`/`totalTaxable`/`totalDiscount`.

2. **Decide the response shape.** Three honest options:
   - **(A) Migrate lossy.** Drop fields backend doesn't read; backend
     updates for any it does. Coordinated cutover.
   - **(B) Add a domain `CreateTaxResponse` envelope.** Capture the
     genuinely-needed missing fields (probably just `status` and
     full per-line details) at the domain level. Plugin returns the
     richer envelope; backend wire contract unchanged. Slight hex
     impurity in exchange for zero backend coordination.
   - **(C) Stay on legacy splat indefinitely.** Acceptable status
     quo. The port still covers `create_tax` for any future
     adapter-internal need; the HTTP route just continues using the
     splat method.

3. **Implement (small PR ~50 lines).** Once decided, the wiring is
   `app/tax/service.py::create_sales_tax` calls
   `request_to_tax_document` + `request_to_enrichment_context` +
   `handler.create_tax(...)` + a response mapper. The response mapper
   changes shape per (2).

No more refactor code is needed before the backend audit happens.

### 1. Rename the colliding "tax handler" identifiers — NOT YET DONE

The colliding identifiers shipped without renaming. Two pre-existing classes share the name with the new
[core/plugin/handlers/base_tax_handler.py](core/plugin/handlers/base_tax_handler.py):

- `core/plugin/tax_handler.py:31` — `class TaxHandler`
- `core/plugin/handlers/strategies/tax.py:48` — `class TaxHandlerBasedStrategy`

These are about per-line tax **resolution** inside the invoice-export
strategy — a different concern from the connector port. Reading
`BaseTaxHandler` next to `TaxHandler` will confuse new contributors.
Rename the existing ones (e.g. `TaxHandler` → `LineTaxResolver`,
`TaxHandlerBasedStrategy` → `ResolvedTaxStrategy`) in a small
mechanical PR before H1 opens. ~30 min, no behaviour change.

### 2. Land `import-linter` config — NOT YET DONE

The H1/H2b/H3a merges shipped without an `import-linter` step. The
plan's "Forbidden imports" section enumerates the rules.
Adding a few lines of `.importlinter` contracts + a CI step in the
same PR as the port is the cheapest way to make the dependency
direction self-enforcing. Without it, H2/H3 reviewers (and the
eventual H4 author) have to spot upward-imports by hand. The contracts
to encode:

- `app/tax/` ↛ `connectors/*`
- `connectors/<any>/` ↛ `app/tax/`
- `connectors/<plugin-a>/` ↛ `connectors/<plugin-b>/`
- `core/domains/tax/` ↛ `app/`, `api/`, `connectors/`

### 3. ✅ Drop the `# TODO(H3)` marker — DONE in H3b

**✅ Marker removed in H3b.** H3b removes 1 of the 5 original splat
sites (`/tax/estimate`) and partially migrates a second
(single-parent `/tax/report_credit_note`; the multi-code fallback
inside the same handler stays splat). **4 splat sites remain on main
post-H3b**: `/tax/create` (line 178), multi-code
`/tax/report_credit_note` fallback (264), legacy `/tax/sales` (457),
and `/tax/commit` (519). Of those, only `/tax/create` is on the
roadmap to migrate (see Plan Deviations #4 and Suggested Work #0);
`/tax/sales`, `/tax/commit`, and the multi-code fallback stay on
splats by design.

### 4. ✅ Policy hoist decisions made explicit — DONE in H2b

Of the 5 Avalara policies on `main` pre-H2b, only the small ones were
provider-neutral. The plan's earlier estimate of "~6 policies, all
neutral" undercounted — half stayed put:

| Policy                | File                                       | Provider-neutral?                                | Action in H2b                                     |
| --------------------- | ------------------------------------------ | ------------------------------------------------ | ------------------------------------------------- |
| Exemption             | `exemption_policy.py` (33 LOC)             | yes                                              | hoist to `core/domains/tax/policies/exemption.py` |
| Discount              | `discount_policy.py` (28 LOC)              | yes                                              | hoist                                             |
| Customer segmentation | `customer_segmentation_policy.py` (31 LOC) | yes                                              | hoist                                             |
| Reporting currency    | `reporting_currency_policy.py` (105 LOC)   | partial — references Avalara `EnrichmentContext` | stays in `connectors/avalara/policies/`           |
| Tax info              | `tax_info_policy.py` (118 LOC)             | partial — references Avalara enums               | stays                                             |

Hoist what's neutral, leave what's coupled. A later PR can untangle
the coupling and finish the hoist if/when it pays off.

### 5. Ship the contract tier — NOT YET DONE

The plan calls for `tests/tax/contracts/` parametrized across every
plugin. H1 shipped without it — there's no `tests/tax/contracts/`
directory on `main`. The contract tier is most valuable once a second
tax-engine plugin is on the horizon (Anrok), so a reasonable trigger
is: scaffold the directory in the same PR that adds Anrok's first
contract conformance test, parametrized over `[Avalara, Anrok]`.
Avalara-only contract tests in advance of that buy little — they
duplicate what plugin-internal integration tests already cover. The
same pattern applies to `TaxRateCatalogPort` once a second catalog
adapter exists.

### 6. ✅ `TaxPlugin` deleted (done in H3c)

`class TaxPlugin(PluginCore)` was a no-op wrapper around `PluginCore`
once `BaseTaxHandler` existed. H3c removed it: Avalara and Taxjar now
inherit from `PluginCore` directly, and the empty wrapper class is
gone.

### 7. ✅ Pure-domain test pyramid — DONE in H2b

H2b hoists models, value objects, exceptions, and a subset of policies
to `core/domains/tax/`. That code is **pure** — no I/O, no async, no
plugin engine — which makes it the cheapest tier in the pyramid. Land
the unit tests in the same PR (`tests/core_test/domains/tax/test_models.py`,
`test_value_objects.py`, `test_policies_*.py`); they replace the
scattered Avalara-specific policy tests on a 1:1 basis. Aim for 100%
line coverage on the pure-domain layer — it's the spec.

### 8. Bounded-context boundary lint for `app/tax/mappers.py`

H3 introduces the HTTP↔domain mapper as the only place where a
`SalesTaxDocumentRequestSchema` (transport) talks to a `TaxDocument`
(domain). A small lint rule that asserts `from app.tax.schema import`
appears **only** in `app/tax/mappers.py` (and tests) within the tax
bounded context would lock the seam in place — preventing a future
contributor from re-introducing transport types deeper in the stack.
Cheap to add as a one-off `grep`-based pre-commit check; promotable to
`import-linter` later.

### 9. `/tax/address/validate` — kept Avalara-specific by design

The route stays on the legacy splat
`instance.validate_resource(**request.address.dict())`. This is a
**deliberate non-migration**, not an oversight.

Rationale: Avalara's address-validation result carries
`ResolutionQuality` (geocoding tier), `AvaTaxMessageSchema`
(per-message severity / category), and `is_address_taxable`
(Avalara-policy-derived). These are vendor-specific concepts whose
cross-provider shape is not knowable until a second tax provider's
adapter exists. The minimum viable port — `async def
validate_address(self, address: Address) -> Address` returning a
normalized address — would lose every detail backend's address-capture
UI uses today. Forcing the abstraction now is over-engineering.

Migration trigger: revisit when a second tax provider's
address-validation result shape lands. At that point the cross-
provider overlap is concrete, and we can decide whether to:

- Hoist a domain `AddressValidationResult` to
  `core/domains/tax/models.py` capturing the shared shape.
- Add `validate_address` to `BaseTaxHandler`.
- Migrate the route through the port.

Until then, the splat path is correct.

### 10. Migrate existing AccountingPlugin adapters onto `TaxRateCatalogPort`

# 880 ships the port + slot but **does not migrate existing adapters**.

On main, Xero, QB, Zoho, and NetSuite all override `get_tax_rates` /
`create_tax_rate` directly on the plugin class — their MRO
short-circuits before the new `AccountingPlugin._get_tax_rate_catalog()`
facade. To realise the port's value, each adapter needs a separate
follow-up PR that:

1. Creates a `connectors/<erp>/infrastructure/tax_rate_catalog.py` that
   subclasses `TaxRateCatalogPort` and houses the existing
   tax-rate-fetch / create logic, returning `ErpTaxCode` instances.
2. Sets `tax_rate_catalog_class = MyErpTaxRateCatalog` on the plugin.
3. Removes the direct `get_tax_rates` / `create_tax_rate` overrides
   on the plugin class.
4. Verifies via integration test that the facade-routed call returns
   the same wire shape downstream consumers expect.

The four adapters can land independently in any order. NetSuite is
likely first because PRs #881 / #884 / #885 are already building the
read-side infrastructure (SuiteQL discovery, SOAP create-tax-code,
Tax Agency/Type resolver) — those would slot directly under a NetSuite
`TaxRateCatalogPort` subclass.

### 11. Retire the `ErpTaxCode.tax_type` ACL alias

# 880 ships `ErpTaxCode` with a Pydantic alias mapping the field name

`id` → wire key `tax_type`. The alias exists because
`core/plugin/tax_handler.py:229` consumes `r.get("tax_type")` from the
dict shape returned by today's adapters; `.dict(by_alias=True)` keeps
the legacy wire shape until that consumer is migrated.

This is **temporary technical debt**, tracked in #880's PR description.
The cleanup PR migrates `core/plugin/tax_handler.py` (and any other
consumer of the legacy dict shape) to construct or accept `ErpTaxCode`
instances directly, then drops the alias from `ErpTaxCode`. Until
then, downstream code reads via `code.dict(by_alias=True).get("tax_type")`
or directly via the alias-aware Pydantic model.

Estimated effort: ~1 small PR (~50–100 lines), driven by whichever
adapter migration in #10 first feels the friction.

### 12. Test the splat-style report_credit_note path — NEW (2026-05-09)

Surfaced by deviation #12. The new invoice_id-driven credit-note flow
on H3b/H3c is reached via `Avalara.report_credit_note_legacy(**request.dict())`

- `CreditNoteService.report_credit_note(invoice_id=..., credit_note_id=..., ...)`,
  not via `app/tax/mappers.py:credit_note_request_to_refund`. Existing
  unit tests in `tests/app_tests/tax/test_mappers.py::TestCreditNoteRequestToRefund`
  cover the mapper path; they exercised the str-coercion and would have
  caught the regression there. They did _not_ cover the splat path,
  which is how the regression slipped through to manual smoke.

Add a unit test that constructs a `ReportCreditNoteRequestSchema`
in invoice_id-driven shape, drives it through the splat path with
a fake gateway + fake `IdempotencyPort` (to mock the
`connector_resource_mapping` lookup that resolves invoice_id → parent
code), and asserts the response envelope. Lives in
`tests/connector_tests/avalara_tests/test_credit_note_service.py`.

Rationale: deviation #12's domain-boundary `Refund` validator now
makes the regression structurally impossible regardless of which path
constructs the model, so this is belt-and-braces — but the splat path
is on the critical path until Suggested Work #0 (`/tax/create`
migration) is resolved, and it's worth being tested.

Estimated effort: ~1 hour, ~80 lines of test code, no source changes.
