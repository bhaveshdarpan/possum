# NetSuite × Avalara Tax Sync — Implementation Plan

> Companion to [netsuite-avalara-tax-sync-prd.md](netsuite-avalara-tax-sync-prd.md)
> (the v1 PRD). Extends the lookup-or-fail manual flow shipped on
> [netsuite-tax-implementation-plan.md](netsuite-tax-implementation-plan.md)
> with an auto-create branch for tenants whose invoices carry
> provider-computed `tax_details` (Avalara in v1, others later).
> Legacy Tax only. SuiteTax remains out of scope.
>
> **v1 scope**: connector-service + backend implementation only. No
> frontend, no provider adapter Protocol, no nexus discovery, no
> observability infrastructure. Customer/support enters
> `nexus_mappings` via the existing connector configuration endpoint.
> Goal of this iteration: prove the auto-create sync works
> end-to-end against a real NetSuite sandbox, then one pilot tenant.

---

## 1. Scope

### 1.1 In v1

1. **connector-service** auto-create branch in
   `TaxResolutionService` — consumes `tax_details` from incoming
   invoices, looks up `nexus_mappings`, auto-creates `SalesTaxItem`
   and `TaxGroup` records on demand via SOAP.
2. **SOAP create operations** in
   `connectors/netsuite/client/operations/tax_create.py` with
   `DUP_RCRD` recovery.
3. **Provider-neutral mapping schema** added to `NetsuiteTaxConfig`:
   `provider` (metadata flag) + `nexus_mappings` (list).
4. **Five new typed error codes** in `NetsuiteTaxErrorCode` enum.
5. **Deterministic naming** for auto-created records.
6. **Structured logging** following existing codebase conventions
   (`event_name`, intent/look-ahead pairs, `ConnectorResponse`
   audit split).
7. **Backend schema validation** for the new `tax.nexus_mappings`
   field via the existing connector configuration endpoint.
8. **Sandbox testing** of six scenarios against real NetSuite.
9. **One pilot tenant** validated end-to-end.

### 1.2 Out of scope for v1 (deferred to later phases)

| Item                                                                                                                                                             | Defer to                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Frontend (Tax Settings UI, Add/Edit drawer, Validate Now button)                                                                                                 | v1.1                                |
| Setup SuiteQL queries (list/validate nexus, tax-type, vendor)                                                                                                    | v1.1 (when FE needs them)           |
| Validate Now endpoint                                                                                                                                            | v1.1 (when FE needs it)             |
| SignOz alerts, dashboards                                                                                                                                        | v1.1                                |
| Migration tooling for existing manual-tax tenants                                                                                                                | v1.x                                |
| First-time setup wizard                                                                                                                                          | v1.1                                |
| Discount handling (header `invoice.discountItem`, validation guards)                                                                                             | v2                                  |
| **Provider auto-detection** (TaxProviderAdapter Protocol, Avalara `list_registered_nexuses()`, "Detect nexuses from provider" UX, cross-connector orchestration) | **Out of v1 — re-evaluate**         |
| TaxJar / Anrok / Stripe Tax adapters                                                                                                                             | Out of v1 — same reasoning as above |

**Note on the Xero-pattern simplification**: Earlier drafts gated
auto-create on a `tax.provider` config field and required a
provider adapter Protocol for cross-connector orchestration. We
dropped both in favour of the Xero precedent
(`connectors/xero/tax_distribution.py:185`) — the resolver picks
auto-create per invoice from `tax.tax_details` being non-empty.
This removes the entire provider-selector + adapter surface from
the implementation without changing what a customer can do at
launch.

---

## 2. Architecture

Builds on the existing hex slice from
[netsuite-tax-implementation-plan.md §4.1](netsuite-tax-implementation-plan.md).
No new layers introduced; the auto-create logic lives inside the
existing `TaxResolutionService` as a new branch.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Driving side: invoice exporter / shared port consumers             │
│   │                                                                 │
│   │ TaxResolutionStrategy    TaxRateCatalogPort                     │
│   ▼                          ▼                                      │
│  connectors/netsuite/handlers/                                      │
│   ├── tax_strategy.py        — NetsuiteLegacyTaxStrategy (exists)   │
│   └── tax_handler.py         — NetsuiteTaxHandler (exists)          │
│   │                                                                 │
│   ▼                                                                 │
│  connectors/netsuite/application/                                   │
│   ├── tax_resolution_service.py    — EXTENDED: auto-create branch   │
│   ├── ports.py                     — UNCHANGED                      │
│   └── config.py                    — EXTENDED: nexus_mappings      │
│   │                                                                 │
│   ▼                                                                 │
│  connectors/netsuite/client/                                        │
│   ├── operations/tax.py            — UNCHANGED (read ops)           │
│   ├── operations/tax_create.py     — NEW: SOAP add SalesTaxItem +   │
│   │                                   TaxGroup with DUP_RCRD        │
│   │                                   recovery                      │
│   └── soap_schemas.py              — EXTENDED: SalesTaxItem +       │
│                                       TaxGroup SOAP record schemas  │
│   │                                                                 │
│   ▼                                                                 │
│  connectors/netsuite/{mappers, schemas}/                            │
│   ├── mappers/tax_naming.py        — NEW: deterministic naming      │
│   │                                  helpers (group hash etc.)      │
│   └── schemas/tax.py               — UNCHANGED (NsTaxCode VO        │
│                                       reused)                       │
└─────────────────────────────────────────────────────────────────────┘
```

**No `Provider Protocol` layer in v1.** The "provider" field on
the config is metadata only — used by future logic but not
consumed by any Protocol-typed adapter today.

---

## 3. Target File Layout

### 3.1 New files

```
connectors/netsuite/
├── client/
│   └── operations/
│       └── tax_create.py                 NEW — SOAP add SalesTaxItem
│                                          and TaxGroup with DUP_RCRD
│                                          recovery; intent/look-ahead
│                                          logging around each SOAP call
├── mappers/
│   └── tax_naming.py                     NEW — deterministic naming
│                                          helpers (promoted from
│                                          connectors/xero/tax_distribution.py)

tests/
├── connector_tests/netsuite_tests/
│   ├── application/
│   │   └── test_tax_resolution_service_auto_create.py
│   │                                      NEW — auto-create branch
│                                          tests (separate from existing
│                                          test_tax_resolution_service.py
│                                          to keep manual-flow tests
│                                          isolated)
│   ├── client_tests/
│   │   └── test_tax_create.py            NEW — SOAP create operation
│                                          tests with DUP_RCRD recovery
│   └── mappers/
│       └── test_tax_naming.py            NEW — naming helper tests
└── _support/fakes/netsuite/
    └── tax.py                             EXTENDED — FakeTaxGateway gets
                                          create_sales_tax_item +
                                          create_tax_group methods
```

### 3.2 Modified files

```
connectors/netsuite/
├── application/
│   ├── config.py                          MODIFIED — add `provider`,
│   │                                       `nexus_mappings: List[NexusMapping]`,
│   │                                       `NexusMapping` Pydantic class
│   └── tax_resolution_service.py          MODIFIED — auto-create branch
├── client/
│   └── soap_schemas.py                    MODIFIED — add SalesTaxItem,
│                                           TaxGroup, TaxGroupTaxItem
│                                           SOAP record classes
└── exception.py                           MODIFIED — five new
                                            NetsuiteTaxErrorCode values

backend/                                   (repo: zenskar/backend, not
                                            connector-service)
└── <connector config validation>          MODIFIED — JSON schema for
                                            tax.nexus_mappings
```

### 3.3 Files left alone (relevant context)

- `connectors/netsuite/handlers/invoice_exporter.py` — no changes;
  existing `_phase_validate` + `_refresh_erp_tax_codes` flow
  unchanged. The auto-create branch lives entirely inside
  `TaxResolutionService.resolve()`.
- `connectors/netsuite/handlers/tax_strategy.py` — no changes.
- `connectors/netsuite/client/operations/tax.py` — no changes; the
  existing `find_*_by_name` operations are reused for DUP_RCRD
  recovery.
- `core/plugin/` — no changes (no Protocol layer in v1).
- `connectors/avalara/` — no changes.

---

## 4. Key Data Structures

### 4.1 `NexusMapping` and `NetsuiteTaxConfig` (in `application/config.py`)

```python
"""Configuration value objects for the NetSuite tax-resolution service."""

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, root_validator


class CanonicalTaxType(str, Enum):
    """Provider-neutral tax-type vocabulary."""
    SALES = "SALES"
    USE = "USE"
    VAT = "VAT"
    GST = "GST"
    HST = "HST"
    PST = "PST"
    RENTAL = "RENTAL"
    LEASE = "LEASE"


class NetSuiteNexusRefs(BaseModel):
    """NetSuite internal IDs referenced by one nexus mapping row."""
    nexus_id: str = Field(..., description="NetSuite Nexus internal id")
    tax_type_id: str = Field(..., description="NetSuite TaxType internal id")
    tax_agency_id: str = Field(
        ..., description="NetSuite Vendor internal id (category=Tax Agency)"
    )


class NexusMapping(BaseModel):
    """One row in the provider-neutral nexus mapping table.

    Customer-configured. Maps a (country, region, tax_type) tuple
    emitted by the upstream tax engine to NetSuite's internal records.
    Subsidiary is NOT included here — it's per-connector context.
    """
    country: str = Field(..., min_length=2, max_length=2, regex=r"^[A-Z]{2}$",
                         description="ISO-3166-1 alpha-2 (e.g. 'US', 'GB')")
    region: Optional[str] = Field(
        None,
        description="Postal code; 2-letter for US/CA states; null for country-wide"
    )
    tax_type: CanonicalTaxType = Field(..., description="Canonical tax type")
    netsuite: NetSuiteNexusRefs

    class Config:
        frozen = True
        allow_mutation = False


class NetsuiteTaxConfig(BaseModel):
    """Tax-related slice of the connector's saved configuration.

    EXTENDED in this PRD: adds `nexus_mappings`. Existing fields
    (`sync_tax`, `tax_codes`, `erp_tax_codes`) unchanged. No
    `provider` flag — the resolver picks auto-create per invoice
    from `tax.tax_details` being non-empty (Xero pattern, see
    `connectors/xero/tax_distribution.py:185`).
    """
    sync_tax: bool = True
    tax_codes: List[ZenskarTaxCodeMapping] = Field(default_factory=list)
    erp_tax_codes: List[ErpTaxCodeMapping] = Field(default_factory=list)

    # ──── NEW IN v1 ────
    nexus_mappings: List[NexusMapping] = Field(default_factory=list)

```

### 4.2 New error codes (in `exception.py`)

```python
class NetsuiteTaxErrorCode(str, Enum):
    # ──── Existing (preserved unchanged) ────
    TAX_CODE_MISSING = "TAX_CODE_MISSING"
    INACTIVE_TAX_CODE = "INACTIVE_TAX_CODE"
    RATE_MISMATCH = "RATE_MISMATCH"
    TAX_GATEWAY_ERROR = "TAX_GATEWAY_ERROR"
    COMBINED_TAX_UNSUPPORTED = "COMBINED_TAX_UNSUPPORTED"

    # ──── NEW IN v1 ────
    NEXUS_MAPPING_MISSING = "NEXUS_MAPPING_MISSING"
    NEXUS_MAPPING_INVALID = "NEXUS_MAPPING_INVALID"
    TAX_GROUPS_FEATURE_DISABLED = "TAX_GROUPS_FEATURE_DISABLED"
    SUBSIDIARY_PERMISSION_DENIED = "SUBSIDIARY_PERMISSION_DENIED"
    AUTO_CREATE_FAILED = "AUTO_CREATE_FAILED"
```

Each new code follows the existing `NetsuiteTaxException` pattern —
`error_code`, `message`, `details: dict` — for consistency with
the manual flow's typed errors.

### 4.3 Naming convention helpers (in `mappers/tax_naming.py`)

```python
"""Deterministic naming helpers for auto-created NetSuite tax records.

Promoted from connectors/xero/tax_distribution.py (where it lived as
derive_avalara_tax_group_key). Now provider-neutral.
"""

import hashlib
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional

from app.invoices.schema import AvalaraTaxJurisdiction  # canonical type

_HASH_LEN = 16
_JURIS_TYPE_CANONICAL_ORDER = {
    "STA": 1, "CTY": 2, "CIT": 3, "STJ": 4, "CNT": 5,
}
_JURIS_TYPE_NORMALIZE = {
    "State": "STA", "STA": "STA",
    "County": "CTY", "CTY": "CTY",
    "City": "CIT", "CIT": "CIT",
    "Special": "STJ", "STJ": "STJ",
    "Country": "CNT", "CNT": "CNT",
}


def normalize_juris_type(raw: str) -> str:
    """Translate provider-emitted juris_type (long or short) to canonical."""
    return _JURIS_TYPE_NORMALIZE.get(raw, raw.upper()[:3])


def format_rate_4dp(rate: Decimal | float) -> str:
    """Format a rate as percent with 4 decimal places, truncated (not rounded).

    Examples:
        0.0625 → '6.2500'
        0.045  → '4.5000'
        0.20   → '20.0000'
    """
    if not isinstance(rate, Decimal):
        rate = Decimal(str(rate))
    # Inputs from providers are sometimes fractions (0.0625) and sometimes
    # percentages (6.25). Convention: caller normalizes to percent first.
    return rate.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP).normalize().to_eng_string()


def generate_sales_tax_item_name_component(
    *, country: str, region: Optional[str], juris_type: str,
    juris_code: str, rate_percent: Decimal,
) -> str:
    """Name pattern for a multi-jurisdiction component SalesTaxItem.

    Example: ZN_US_CA_STA_06_6.2500
    """
    region_segment = region if region else ""
    return (
        f"ZN_{country}_{region_segment}_"
        f"{normalize_juris_type(juris_type)}_{juris_code}_"
        f"{format_rate_4dp(rate_percent)}"
    )


def generate_sales_tax_item_name_country_wide(
    *, country: str, tax_type: str, rate_percent: Decimal,
) -> str:
    """Name pattern for a country-wide single-rate SalesTaxItem.

    Example: ZN_GB_VAT_20.0000
    """
    return f"ZN_{country}_{tax_type}_{format_rate_4dp(rate_percent)}"


def generate_tax_group_name(
    *, country: str, region: Optional[str],
    tax_details: List[AvalaraTaxJurisdiction],
) -> str:
    """Name pattern for a multi-jurisdiction TaxGroup.

    Example: ZN_GRP_US_NY_a1b2c3d4e5f6g7h8

    The 16-char hash encodes the full (juris_code, juris_type, rate_4dp)
    composition sorted canonically (STA → CTY → CIT → STJ → CNT;
    ties broken by juris_code).
    """
    region_segment = region if region else ""

    # Canonical sort
    sorted_details = sorted(
        tax_details,
        key=lambda d: (
            _JURIS_TYPE_CANONICAL_ORDER.get(
                normalize_juris_type(d.juris_type or "CNT"), 99
            ),
            d.juris_code or "",
        ),
    )

    # Hash input: deterministic concatenation
    parts = "_".join(
        f"{normalize_juris_type(d.juris_type or 'CNT')}_"
        f"{d.juris_code or '0'}_"
        f"{format_rate_4dp(Decimal(str(d.rate)))}"
        for d in sorted_details
    )
    hash_suffix = hashlib.md5(parts.encode("utf-8")).hexdigest()[:_HASH_LEN]

    return f"ZN_GRP_{country}_{region_segment}_{hash_suffix}"
```

**Important**: the naming is purely deterministic. Same input
composition → same hash → same name. See PRD §4.4 for the
correctness analysis and edge cases (zero-rate jurisdictions,
rate precision, provider field-name normalization).

### 4.4 SOAP record classes (in `client/soap_schemas.py`)

NetSuite's `SalesTaxItem` and `TaxGroup` SOAP records aren't yet
defined in our `soap_schemas.py` (they were only consumed via
SuiteQL in the lookup-only manual flow). The new file additions:

```python
# Existing: RecordRef, Record, NS_LISTS, etc.

# ──── NEW IN v1 ────

@dataclass
class SalesTaxItem(Record):
    """NetSuite SalesTaxItem SOAP record (Legacy Tax).

    Reference: docs.oracle.com/.../section_N2039577.html
    """
    item_id: Optional[str] = field(
        default=None,
        metadata={"name": "itemId", "type": "Element", "namespace": NS_LISTS_ACCT},
    )
    rate: Optional[str] = field(
        default=None,
        metadata={"name": "rate", "type": "Element", "namespace": NS_LISTS_ACCT},
    )
    description: Optional[str] = field(
        default=None,
        metadata={"name": "description", "type": "Element", "namespace": NS_LISTS_ACCT},
    )
    nexus: Optional[RecordRef] = field(
        default=None,
        metadata={"name": "nexus", "type": "Element", "namespace": NS_LISTS_ACCT},
    )
    tax_type: Optional[RecordRef] = field(
        default=None,
        metadata={"name": "taxType", "type": "Element", "namespace": NS_LISTS_ACCT},
    )
    tax_agency: Optional[RecordRef] = field(
        default=None,
        metadata={"name": "taxAgency", "type": "Element", "namespace": NS_LISTS_ACCT},
    )
    subsidiary_list: Optional[RecordRefList] = field(
        default=None,
        metadata={"name": "subsidiaryList", "type": "Element", "namespace": NS_LISTS_ACCT},
    )
    state: Optional[str] = field(
        default=None,
        metadata={"name": "state", "type": "Element", "namespace": NS_LISTS_ACCT},
    )
    is_inactive: Optional[bool] = field(
        default=False,
        metadata={"name": "isInactive", "type": "Element", "namespace": NS_LISTS_ACCT},
    )


@dataclass
class TaxGroupTaxItem:
    """One entry in the TaxGroup.taxItemList sublist."""
    tax_item: Optional[RecordRef] = field(
        default=None,
        metadata={"name": "taxItem", "type": "Element", "namespace": NS_LISTS_ACCT},
    )


@dataclass
class TaxGroupTaxItemList:
    tax_item: List[TaxGroupTaxItem] = field(
        default_factory=list,
        metadata={"name": "taxItem", "type": "Element", "namespace": NS_LISTS_ACCT},
    )


@dataclass
class TaxGroup(Record):
    """NetSuite TaxGroup SOAP record (Legacy Tax).

    Reference: docs.oracle.com/.../section_N2039890.html
    """
    item_id: Optional[str] = field(
        default=None,
        metadata={"name": "itemId", "type": "Element", "namespace": NS_LISTS_ACCT},
    )
    description: Optional[str] = field(
        default=None,
        metadata={"name": "description", "type": "Element", "namespace": NS_LISTS_ACCT},
    )
    nexus_country: Optional[RecordRef] = field(
        default=None,
        metadata={"name": "nexusCountry", "type": "Element", "namespace": NS_LISTS_ACCT},
    )
    subsidiary_list: Optional[RecordRefList] = field(
        default=None,
        metadata={"name": "subsidiaryList", "type": "Element", "namespace": NS_LISTS_ACCT},
    )
    tax_item_list: Optional[TaxGroupTaxItemList] = field(
        default=None,
        metadata={"name": "taxItemList", "type": "Element", "namespace": NS_LISTS_ACCT},
    )
    state: Optional[str] = field(
        default=None,
        metadata={"name": "state", "type": "Element", "namespace": NS_LISTS_ACCT},
    )
    is_inactive: Optional[bool] = field(
        default=False,
        metadata={"name": "isInactive", "type": "Element", "namespace": NS_LISTS_ACCT},
    )
```

Verify field names against the live NetSuite WSDL during Phase 1
PR-A1 — schema browser pages return 403 to anonymous WebFetch, so
the implementing engineer should pull the WSDL via an authenticated
session before writing these classes.

---

## 5. Phased Implementation

Four phases. Track A (connector-service) and Track B (backend) run
in parallel after Phase 0. Phase 3 wires them through sandbox; Phase
4 puts a customer on it.

### 5.1 Phase 0 — Foundation (Days 1-2)

Both tracks lock contracts before any behavioral code ships.

| #   | Title                                                       | Track | Files touched                                                                                                                       | Days |
| --- | ----------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ---- |
| F1  | `feat(netsuite): add NexusMapping config + new error codes` | A     | `application/config.py`, `exception.py`, `mappers/tax_naming.py`, `tests/connector_tests/netsuite_tests/mappers/test_tax_naming.py` | 2    |
| F2  | `feat(backend): JSON schema for tax.nexus_mappings`         | B     | Backend connector config validator + schema docs                                                                                    | 1    |

**F1 scope**: Pure types + helpers. `NexusMapping`,
`CanonicalTaxType`, five new `NetsuiteTaxErrorCode` values, three
naming helper functions, full unit tests for the helpers (canonical
sort, hash determinism, format_rate_4dp edge cases). No behavior
change — the resolver doesn't read `nexus_mappings` yet.

**F2 scope** (PR #4268, shipped on branch
`feat/netsuite-tax-nexus-mappings-schema`): shared Pydantic schema
for `TaxConfig.nexus_mappings`. Models only — no endpoint-level
validation hookup; consumption-side validation in connector-service
catches malformed data at sync time (Xero precedent — see §5.3).

**Phase 0 checkpoint**: F1 merged to `main`. F2 merged in the
backend repo. Schema contract is the only durable artifact.

### 5.2 Phase 1 — Connector-service auto-create (Days 3-13)

Four sequential PRs on Track A.

| #   | Title                                                                             | Depends on | Days |
| --- | --------------------------------------------------------------------------------- | ---------- | ---- |
| A1  | `feat(netsuite): SOAP SalesTaxItem + TaxGroup record classes + create operations` | F1         | 3    |
| A2  | `feat(netsuite): consume nexus_mappings in NetsuiteTaxConfig`                     | F1         | 1    |
| A3  | `feat(netsuite): auto-create branch in TaxResolutionService.resolve()`            | A1, A2     | 4    |
| A4  | `test(netsuite): auto-create resolver test suite`                                 | A3         | 3    |

**A1 — SOAP create operations**:

- Add `SalesTaxItem`, `TaxGroup`, `TaxGroupTaxItem`, `TaxGroupTaxItemList` dataclasses to `connectors/netsuite/client/soap_schemas.py` (see §4.4).
- Create `connectors/netsuite/client/operations/tax_create.py` with two methods:
  - `create_sales_tax_item(item: SalesTaxItem) -> NsTaxCode`
  - `create_tax_group(group: TaxGroup) -> NsTaxCode`
- Both methods:
  1. Log intent: `logger.info(event_name="netsuite.tax.soap_add.intent", record_type=…, item_id=…)`
  2. Issue SOAP `add` via the existing `SoapClient`
  3. On `DUP_RCRD` error: log it, re-fetch via existing `find_*_by_name` from `operations/tax.py`, return the existing record
  4. On other SOAP errors: raise `NetsuiteTaxException(AUTO_CREATE_FAILED)` with the raw NetSuite error in `details`
  5. Log outcome: `logger.info(event_name="netsuite.tax.soap_add.outcome", record_type=…, internal_id=…, outcome="created"|"adopted")`
- Persist audit trail entry via `ConnectorResponse` (existing pattern).

**A2 — Config consumption**:

- Update `NetsuiteTaxConfig` (already partially done in F1) — confirm Pydantic round-trips correctly with the `configuration.tax.*` JSONB column.
- No resolver behavior change; this PR just makes the new fields visible to the existing `_refresh_erp_tax_codes` flow.

**A3 — Auto-create branch in resolver**:

- Extend `TaxResolutionService.resolve()` (in `application/tax_resolution_service.py`):

```python
# New high-level shape (pseudocode — actual implementation has more error handling).
# Branch picked per invoice from data shape — matches Xero precedent at
# connectors/xero/tax_distribution.py:185.
async def resolve(self, *, tax: Tax, config: NetsuiteTaxConfig) -> NsTaxCode:
    # Manual mode: existing lookup-or-fail path unchanged
    if not tax.tax_details:
        return self._resolve_manual(tax=tax, config=config)

    # Auto-create mode (new)
    return await self._resolve_auto_create(tax=tax, config=config)

async def _resolve_auto_create(self, *, tax: Tax, config: NetsuiteTaxConfig) -> NsTaxCode:
    # 1. Validate (country, region, tax_type) tuples are mapped
    missing = self._find_missing_mappings(tax.tax_details, config.nexus_mappings)
    if missing:
        raise NetsuiteTaxException(
            error_code=NetsuiteTaxErrorCode.NEXUS_MAPPING_MISSING,
            message=f"{len(missing)} jurisdictions have no NetSuite mapping configured",
            details={"missing_mappings": [m.dict() for m in missing]},
        )

    # 2. Single jurisdiction → SalesTaxItem; multi → TaxGroup
    details = tax.tax_details or []
    if len(details) <= 1:
        return await self._resolve_single_jurisdiction(tax=tax, config=config)
    return await self._resolve_multi_jurisdiction(tax=tax, config=config)

async def _resolve_single_jurisdiction(self, *, tax, config) -> NsTaxCode:
    detail = tax.tax_details[0]  # or synthesize from tax.rate if no details
    mapping = self._find_mapping(detail.country, detail.region, detail.tax_type, config)
    name = generate_sales_tax_item_name_component(
        country=detail.country, region=detail.region,
        juris_type=detail.juris_type, juris_code=detail.juris_code,
        rate_percent=Decimal(str(detail.rate)),
    )
    cached = self._cache_lookup(config.erp_tax_codes, name)
    if cached:
        return self._verify_and_return(cached, detail.rate)
    # Cache miss → SOAP create
    item = self._build_sales_tax_item(name, mapping, detail)
    created = await self._gateway.create_sales_tax_item(item)
    self._append_to_cache(config.erp_tax_codes, created)
    return created

async def _resolve_multi_jurisdiction(self, *, tax, config) -> NsTaxCode:
    # Resolve every component first (recursively, sort of)
    component_ids = []
    for detail in tax.tax_details:
        component = await self._resolve_single_jurisdiction(
            tax=Tax(tax_codes=tax.tax_codes, rate=detail.rate, tax_details=[detail]),
            config=config,
        )
        component_ids.append(component.internal_id)

    # Then resolve / create the group
    group_name = generate_tax_group_name(
        country=tax.tax_details[0].country,
        region=tax.tax_details[0].region,
        tax_details=tax.tax_details,
    )
    cached_group = self._cache_lookup(config.erp_tax_codes, group_name)
    if cached_group:
        return cached_group
    group = self._build_tax_group(group_name, component_ids, tax.tax_details, config)
    created = await self._gateway.create_tax_group(group)
    self._append_to_cache(config.erp_tax_codes, created)
    return created
```

- Five new error codes wired with actionable messages (see §5.4 for message templates).
- Aggregated reporting for `NEXUS_MAPPING_MISSING` (full list of missing tuples in `details.missing_mappings`).
- `ConnectorResponse` audit entry per created record.
- Cache mutation is append-only mid-sync.

**A4 — Test suite**:

- New file `tests/connector_tests/netsuite_tests/application/test_tax_resolution_service_auto_create.py`.
- Test scenarios:
  1. Single-jurisdiction happy path (CA STATE 6.25%, cache miss → create)
  2. Single-jurisdiction cache hit (same invoice twice, second hits cache)
  3. Multi-jurisdiction happy path (NY State + City + Special — use the user-supplied payload as a fixture)
  4. `NEXUS_MAPPING_MISSING` for unmapped tuple, with aggregated list
  5. `RATE_MISMATCH` on cache hit
  6. `INACTIVE_TAX_CODE` on cache hit (status != ACTIVE)
  7. `AUTO_CREATE_FAILED` on SOAP error
  8. `DUP_RCRD` recovery succeeds (race condition simulation)
  9. Mid-sync cache mutation (line 1 creates, line 2 hits cache)
- Extend `tests/_support/fakes/netsuite/tax.py` (`FakeTaxGateway`) with `create_sales_tax_item` and `create_tax_group` methods that track call history.

**Phase 1 checkpoint**: All four PRs merged behind the `provider != MANUAL` config gate. Auto-create works end-to-end against `NETSUITE_FAKE=1`. No real customer using it yet.

### 5.3 Phase 2 — Backend wiring

**Status: skipped.** Original plan called for B1 (backend validates
`tax.provider` + `tax.nexus_mappings` on PATCH) and B2 (integration
tests for that validator). Both dropped after auditing how Xero
(and every other connector) handles its tax config today.

**Why skipped:**

- `PATCH /connectors/{connector_name}` in
  [api/organisation.py](https://github.com/zenskar/backend/blob/main/api/organisation.py)
  accepts a bare `dict` for _every_ connector and merges through
  `ConfigurationService.merge_connector_data` (one-level dict
  overlay). There's a `# TODO ENFORCE PYDANTIC SCHEMA` comment that's
  never been actioned.
- Xero stores `tax.tax_codes` the same unvalidated way — confirmed
  via a migration backfill (`736367491c3c_backfill_xero_tax_config.py`)
  that writes `{"tax": {"tax_codes": []}}` directly, no validator
  in the path.
- The merge layer already preserves `tax.tax_codes` when only
  `tax.nexus_mappings` is updated, so the persistence concern B1 was
  meant to address is non-existent.
- Validation **does** happen — at the **consumption** boundary in
  connector-service. `TaxResolutionService` raises typed exceptions
  (`NEXUS_MAPPING_MISSING`, `NEXUS_MAPPING_INVALID`,
  `RATE_MISMATCH`) when the data is bad at sync time. Same pattern
  Xero uses.
- F2 (PR #4268,
  `feat/netsuite-tax-nexus-mappings-schema`) is **sufficient** for
  Phase 2 needs: shared Pydantic models (`TaxConfig`, `NexusMapping`,
  `CanonicalTaxType`) that connector-service imports and the
  eventual frontend will bind to.

**If we ever do want backend validation**, it should be a
platform-wide initiative (validate every connector's config against
`ConnectorConfiguration`), not a NetSuite-only hook — that's a
separate architectural conversation outside this PRD's scope.

**Phase 2 checkpoint**: Customer/support can `PATCH
/connectors/netsuite` with `tax.nexus_mappings = [...]` via the
existing endpoint. No new validator runs; malformed data surfaces
as a typed `NetsuiteTaxException` at first sync. The resolver
picks auto-create per invoice from `tax.tax_details` (Xero
pattern, §4.2) — no provider flag.

### 5.4 Error message templates

Used in the resolver (A3) for the five new codes:

```
NEXUS_MAPPING_MISSING (aggregated):
  message:
    "{N} jurisdictions have no NetSuite mapping configured"
  details:
    missing_mappings: [
      {country, region, tax_type}, ...
    ]
  customer_action:
    "Add a mapping row for each listed (country, region, tax_type) tuple
     under the tax.nexus_mappings field of your connector configuration.
     For each, confirm the NetSuite Nexus, TaxType, and TaxAgency vendor
     exist first."

NEXUS_MAPPING_INVALID (per-row):
  message:
    "Nexus mapping for ({country}, {region}, {tax_type}) references
     NetSuite {record_type} id {ns_id} which is missing or inactive."
  details:
    country, region, tax_type, record_type, ns_id

TAX_GROUPS_FEATURE_DISABLED:
  message:
    "Invoice has a multi-jurisdiction tax composition but NetSuite's
     Tax Groups feature is disabled on this account."
  customer_action:
    "Enable Tax Groups at Setup → Accounting → Taxes → Set Up Taxes,
     then resync."

SUBSIDIARY_PERMISSION_DENIED:
  message:
    "The SuiteTalk integration role lacks Create permission on
     {record_type} for subsidiary {subsidiary_id}."
  details:
    record_type, subsidiary_id, raw_netsuite_error
  customer_action:
    "Grant the integration role Lists → Tax Items → Create permission."

AUTO_CREATE_FAILED:
  message:
    "SOAP add of {record_type} '{item_id}' failed: {raw_netsuite_error}"
  details:
    record_type, item_id, raw_netsuite_error, soap_request_id
```

### 5.5 Logging conventions

Per the existing `logging` skill in this codebase. Each new operation emits:

- **Intent log** (before external call):

  ```
  logger.info(
      "netsuite.tax.soap_add.intent",
      record_type="SalesTaxItem", item_id="ZN_US_CA_STA_06_6.2500",
      mapping_tuple=("US", "CA", "SALES"), subsidiary_id=1,
  )
  ```

- **Outcome log** (after external call):

  ```
  logger.info(
      "netsuite.tax.soap_add.outcome",
      record_type="SalesTaxItem", internal_id="42",
      outcome="created", duration_ms=420,
  )
  # or outcome="adopted" on DUP_RCRD recovery
  # or outcome="failed" with error_code field on exception
  ```

- **Cache lookup**:

  ```
  logger.debug(
      "netsuite.tax.cache_lookup",
      item_id="ZN_US_CA_STA_06_6.2500", result="hit"|"miss",
  )
  ```

- **Resolver entry**:

  ```
  logger.info(
      "netsuite.tax.resolve.start",
      provider="avalara", jurisdiction_count=3, tax_codes_key=…
  )
  ```

- **`ConnectorResponse` audit entries**: one row per auto-created record (existing pattern; raw_request + raw_response + status).

No new alert infrastructure. No new dashboards. The structured fields are sufficient for ad-hoc SignOz queries during the pilot.

---

## 6. Testing Plan

### 6.1 Unit tests (per layer)

| Layer                                                 | Location                                                                                      | Coverage                                                                                                                                                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mappers/tax_naming.py`                               | `tests/connector_tests/netsuite_tests/mappers/test_tax_naming.py`                             | All three name-generators; canonical sort determinism; hash determinism (golden fixtures); juris_type normalization (long form vs short form); rate format edge cases (truncation, leading zero, 6dp inputs) |
| `application/config.py` (Pydantic)                    | `tests/connector_tests/netsuite_tests/application/test_config.py`                             | `NexusMapping` validation; canonical vocab enforcement; country/region format validation                                                                                                                     |
| `application/tax_resolution_service.py` (auto-create) | `tests/connector_tests/netsuite_tests/application/test_tax_resolution_service_auto_create.py` | The 9 scenarios from §5.2 A4                                                                                                                                                                                 |
| `client/operations/tax_create.py`                     | `tests/connector_tests/netsuite_tests/client_tests/test_tax_create.py`                        | Happy path; `DUP_RCRD` recovery; non-recoverable SOAP errors; intent/outcome logging fields present                                                                                                          |

### 6.2 Integration tests (via fakes)

`tests/_support/fakes/netsuite/tax.py` extended:

```python
@dataclass
class FakeTaxGateway:
    items: Dict[str, NsTaxCode] = field(default_factory=dict)
    groups: Dict[str, NsTaxCode] = field(default_factory=dict)
    create_history: List[Tuple[str, str]] = field(default_factory=list)

    async def create_sales_tax_item(self, item: SalesTaxItem) -> NsTaxCode:
        # Track calls + simulate duplicate detection
        ...

    async def create_tax_group(self, group: TaxGroup) -> NsTaxCode:
        ...
```

Integration tests in `tests/connector_tests/netsuite_tests/integration/`
drive the full invoice exporter flow through the fake gateway. One
golden test per scenario from §5.2 A4.

### 6.3 Sandbox testing

See §7 (sandbox testing script extension).

### 6.4 Coverage gates (CI)

- Per existing project gates: overall ≥ 73%, new code ≥ 80%, modified code ≥ 10%.
- `mypy --strict` on the new files:

  ```bash
  mypy --strict \
    connectors/netsuite/application/config.py \
    connectors/netsuite/application/tax_resolution_service.py \
    connectors/netsuite/client/operations/tax_create.py \
    connectors/netsuite/mappers/tax_naming.py \
    connectors/netsuite/exception.py
  ```

---

## 7. Sandbox Testing Script — Extension to `netsuite-tax-sandbox-smoke.md`

This section extends the existing
[netsuite-tax-sandbox-smoke.md](netsuite-tax-sandbox-smoke.md) with
six new scenarios covering the auto-create flow. Pre-conditions
inherit from that doc (NetSuite sandbox set up, credentials in
Vault, local connector-service running).

### 7.1 New sandbox preconditions

In the NetSuite sandbox, **manually pre-create**:

- One additional `TaxAgency` vendor: `Zenskar_US_CA_SALES_Tax`
  (Vendor with Category = "Tax agency"). Note its internal id.
- Confirm the `TaxType` for US Sales Tax exists (typically auto-
  created with US nexus). Note its internal id.
- Confirm the US Nexus exists. Note its internal id.
- Confirm the Tax Groups feature is enabled
  (Setup → Accounting → Taxes → Set Up Taxes → "Tax Code Lists
  Include" ≠ "Tax Codes Only").

Export to env:

```bash
export NS_NEXUS_US_ID="..."
export NS_TAX_TYPE_US_SALES_ID="..."
export NS_TAX_AGENCY_US_CA_SALES_ID="..."
export NS_SUBSIDIARY_ID="..."
```

### 7.2 Configure the connector

```bash
# PATCH the connector with provider=avalara + nexus_mappings
curl -X PATCH http://localhost:8001/connectors/{connector_id}/configuration \
  -H 'organisation: 00000000-0000-0000-0000-000000000001' \
  -H 'Content-Type: application/json' \
  -d @- <<EOF
{
  "tax": {
    "sync_tax": true,
    "provider": "avalara",
    "nexus_mappings": [
      {
        "country": "US",
        "region": "CA",
        "tax_type": "SALES",
        "netsuite": {
          "nexus_id": "${NS_NEXUS_US_ID}",
          "tax_type_id": "${NS_TAX_TYPE_US_SALES_ID}",
          "tax_agency_id": "${NS_TAX_AGENCY_US_CA_SALES_ID}"
        }
      },
      {
        "country": "US",
        "region": "NY",
        "tax_type": "SALES",
        "netsuite": {
          "nexus_id": "${NS_NEXUS_US_ID}",
          "tax_type_id": "${NS_TAX_TYPE_US_SALES_ID}",
          "tax_agency_id": "${NS_TAX_AGENCY_US_NY_SALES_ID}"
        }
      }
    ]
  }
}
EOF
```

### 7.3 Scenario 1 — Single-jurisdiction (CA STATE 6.25%)

```bash
curl -X POST http://localhost:8001/connectors/{connector_id}/invoices/sync \
  -H 'organisation: 00000000-0000-0000-0000-000000000001' \
  -d @tests/_fixtures/netsuite/invoice_ca_state_6_25.json
```

**Fixture** (`invoice_ca_state_6_25.json`) — invoice with one line, $1000 amount, tax feature carrying:

- `tax_codes`: "ZN_US_CA_STA_06_6.2500"
- `rate`: 6.25
- `tax_details`: 1 entry (CA STATE, juris_code 06, juris_type STA, rate 6.25, country US)

**Expected**:

- Connector creates SalesTaxItem `ZN_US_CA_STA_06_6.2500` in NetSuite.
- Invoice posted with `line.taxCode` = the new SalesTaxItem internal id.
- NetSuite-computed tax: $62.50 (matches Avalara).
- Verify in NetSuite UI: invoice tax line is $62.50; the new SalesTaxItem record exists and is active.

### 7.4 Scenario 2 — Second invoice in same jurisdiction (cache hit)

Same payload as Scenario 1, run immediately after.

**Expected**:

- No new SOAP `add` call (verify in connector-service logs: no `netsuite.tax.soap_add.intent` event).
- Invoice posted with the same SalesTaxItem internal id.
- Cache hit logged.

### 7.5 Scenario 3 — Multi-jurisdiction (NY State + City + Special)

```bash
curl -X POST http://localhost:8001/connectors/{connector_id}/invoices/sync \
  -H 'organisation: 00000000-0000-0000-0000-000000000001' \
  -d @tests/_fixtures/netsuite/invoice_ny_multi_jurisdiction.json
```

**Fixture** — uses the exact payload structure from the user-supplied NY example (State 4% + City 4.5% + Special 0.375% = 8.875% on $121).

**Expected**:

- Connector creates THREE SalesTaxItems: `ZN_US_NY_STA_36_4.0000`, `ZN_US_NY_CIT_51000_4.5000`, `ZN_US_NY_STJ_359071_0.3750`.
- Connector creates ONE TaxGroup: `ZN_GRP_US_NY_<hash>` referencing the three items.
- Invoice posted with `line.taxCode` = the TaxGroup internal id (applied via `distribute_top_level_tax`).
- NetSuite-computed tax: $10.74 (matches Avalara).
- Verify in NetSuite UI: invoice tax line is $10.74; TaxGroup composition shows the three components in canonical order (STA → CIT → STJ).

### 7.6 Scenario 4 — `NEXUS_MAPPING_MISSING`

Submit an invoice with `tax_details` for `(US, OR, SALES)` — not in
`nexus_mappings`.

**Expected**:

- Sync fails with HTTP 400 (or 422), error body:

  ```json
  {
    "error_code": "NEXUS_MAPPING_MISSING",
    "message": "1 jurisdiction has no NetSuite mapping configured",
    "details": {
      "missing_mappings": [
        { "country": "US", "region": "OR", "tax_type": "SALES" }
      ]
    }
  }
  ```

- No NetSuite records created.

### 7.7 Scenario 5 — `RATE_MISMATCH`

In NetSuite UI, manually edit the `ZN_US_CA_STA_06_6.2500` item's
rate to 7.0% (for the test). Resync a CA STATE invoice.

**Expected**:

- Sync fails with `RATE_MISMATCH`.
- No silent fallback; the bad rate doesn't propagate.

(Reset the rate to 6.25% after the test.)

### 7.8 Scenario 6 — `TAX_GROUPS_FEATURE_DISABLED`

Either (a) use a separate sandbox with Tax Groups disabled, or (b)
mock-disable via SuiteQL error injection at the gateway boundary.
Sync a multi-jurisdiction invoice.

**Expected**:

- Sync fails with `TAX_GROUPS_FEATURE_DISABLED`.
- Single-jurisdiction invoices unaffected (re-test Scenario 1 to confirm).

### 7.9 Post-test cleanup

```bash
# List created records by SuiteQL
echo "SELECT id, itemid FROM salestaxitem WHERE itemid LIKE 'ZN_%' ORDER BY id;"
echo "SELECT id, itemid FROM taxgroup WHERE itemid LIKE 'ZN_%' ORDER BY id;"
```

Created records remain in the sandbox between test runs (NetSuite
forbids deletion of records referenced by transactions). For a
clean sandbox, drop the test invoices first via NetSuite UI, then
inactivate the `ZN_*` records.

---

## 8. Support Runbook

### 8.1 Onboarding a pilot tenant

**Prerequisites (customer-side)**:

1. Customer has Avalara configured in Zenskar (existing flow; out of scope for this work).
2. Customer's NetSuite connector is already operational (existing flow).
3. Customer has identified the nexuses they're registered in.

**Step 1 — Pre-flight questionnaire**

Send the tenant the pre-pilot questionnaire (§9). Get back:

- Their list of `(country, region, tax_type)` tuples they need supported.
- Per nexus: confirmation that NetSuite Nexus, TaxAgency vendor, TaxType records exist.
- The internal IDs for each.
- Confirmation that Tax Groups feature is enabled (multi-jurisdiction support).

**Step 2 — Build the `nexus_mappings` payload**

For each row in the questionnaire, build one entry:

```json
{
  "country": "US", // from customer
  "region": "CA", // from customer (postal code)
  "tax_type": "SALES", // canonical vocab
  "netsuite": {
    "nexus_id": "<from customer>",
    "tax_type_id": "<from customer>",
    "tax_agency_id": "<from customer>"
  }
}
```

**Step 3 — Apply via connector configuration endpoint**

```bash
curl -X PATCH "${ZENSKAR_API}/connectors/${connector_id}/configuration" \
  -H "Authorization: Bearer ${admin_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "tax": {
      "provider": "avalara",
      "nexus_mappings": [
        {...},
        {...}
      ]
    }
  }'
```

Expect HTTP 200 on success. If 400, the validation error names the
malformed field — fix and retry.

**Step 4 — Test sync**

Have the customer sync a small test invoice (one line, simple jurisdiction). Monitor connector-service logs in real time for the `event_name=netsuite.tax.*` events. Verify the invoice posts in NetSuite with correct tax.

**Step 5 — Open up**

After 1-2 successful syncs, the customer can resume normal invoice volumes. Stay on-call (Slack DM or similar) for the first 24 hours.

### 8.2 Troubleshooting per error code

#### `NEXUS_MAPPING_MISSING`

**Symptom**: Sync fails. Error details list one or more `(country, region, tax_type)` tuples.
**Action**: For each missing tuple, ensure the customer has the corresponding NetSuite records (Nexus, TaxAgency vendor, TaxType). Get the internal IDs from the customer. Append a row to `tax.nexus_mappings` via Step 3 above.

#### `NEXUS_MAPPING_INVALID`

**Symptom**: Sync fails. Error details name a specific NetSuite ID (e.g., `tax_agency_id: 8765`) that's missing or inactive.
**Action**: In NetSuite UI, look up the ID. If the record was deleted or inactivated, either restore it or update the mapping row to point at a different valid record.

#### `RATE_MISMATCH`

**Symptom**: An existing `ZN_*` SalesTaxItem in NetSuite has a rate that differs from what Avalara just computed.
**Action**: Two paths:

- If Avalara's rate is correct: inactivate the old `ZN_*` SalesTaxItem in NetSuite (Lists → Accounting → Items, search for the name). The next sync will create a new record with the right rate.
- If the existing rate is correct (customer overrode it intentionally): update Avalara's rate to match, or override the customer's tax setup.

#### `INACTIVE_TAX_CODE`

**Symptom**: An existing `ZN_*` record matches by name but is inactive.
**Action**: Reactivate the record in NetSuite, or inactivate it permanently and let the next sync create a fresh one.

#### `TAX_GROUPS_FEATURE_DISABLED`

**Symptom**: Multi-jurisdiction invoice fails; single-jurisdiction invoices for the same tenant work.
**Action**: Have the customer enable Tax Groups at Setup → Accounting → Taxes → Set Up Taxes. Change "Tax Code Lists Include" to "Tax Groups and Tax Codes". Resync.

#### `SUBSIDIARY_PERMISSION_DENIED`

**Symptom**: Sync fails when the resolver attempts SOAP `add`. NetSuite returns a permission error.
**Action**: The SuiteTalk integration role (Setup → Users/Roles → Roles) needs Create permission on Tax Items. Have the customer's NetSuite admin grant Lists → Tax Items → Create on the role.

#### `AUTO_CREATE_FAILED`

**Symptom**: SOAP error during create that wasn't `DUP_RCRD`, permissions, or feature-disabled.
**Action**: Read the raw NetSuite error in `details.raw_netsuite_error`. Common causes:

- Subsidiary mismatch (mapping's `nexus_id` belongs to a different subsidiary than the connector's)
- Tax-type-nexus inconsistency (mapping's `tax_type_id`'s nexus differs from `nexus_id`)
- Invalid character in description / itemId (NetSuite has a small set of reserved chars)
  Triage with the engineering team; this is the catch-all error code.

### 8.3 Disabling auto-create temporarily

If a customer needs to revert to the manual lookup-or-fail flow:

```bash
curl -X PATCH "${ZENSKAR_API}/connectors/${connector_id}/configuration" \
  -H "Authorization: Bearer ${admin_token}" \
  -d '{"tax": {"provider": "manual"}}'
```

The resolver routes back to the existing `_resolve_manual` branch.
Their pre-existing `tax.tax_codes` mappings (if any) continue to
work as before. The `nexus_mappings` field is preserved in the
config but ignored.

---

## 9. Pre-Pilot Tenant Questionnaire

Hand this to the pilot customer's NetSuite admin during Phase 4 P1.

### Section A — General setup

- [ ] Is NetSuite OneWorld enabled on your account? (Required.)
- [ ] Is the Tax Groups feature enabled?
      (Setup → Accounting → Taxes → Set Up Taxes → "Tax Code Lists Include")
      Allowed values: "Tax Groups Only" or "Tax Groups and Tax Codes".
- [ ] Is the Advanced Taxes feature enabled?
      (Setup → Company → Enable Features → Tax tab)
- [ ] Are you currently using SuiteTax, or Legacy Tax?
      (We support Legacy Tax only in v1.)
- [ ] Has Zenskar's NetSuite connector been live on your account previously?
      If yes — for how long, and what tax flow has it used?

### Section B — Subsidiary mapping

- [ ] What is the NetSuite Subsidiary ID this connector maps to?
      `subsidiary_id`: **\_\_\_\_**

### Section C — Per-nexus information

For each jurisdiction where you sell into and want auto-create
support, fill out a row:

| Country | Region | Tax type | NetSuite Nexus ID | NetSuite TaxType ID | NetSuite TaxAgency Vendor ID |
| ------- | ------ | -------- | ----------------- | ------------------- | ---------------------------- |
|         |        |          |                   |                     |                              |
|         |        |          |                   |                     |                              |

**Guidance**:

- `Country`: ISO-3166-1 alpha-2 (e.g., `US`, `GB`, `IN`).
- `Region`: 2-letter postal abbreviation for US/CA states (`CA`, `NY`, `ON`). Leave blank for country-wide tax (UK VAT, India GST federal, etc.).
- `Tax type`: `SALES`, `USE`, `VAT`, `GST`, `HST`, `PST`, `RENTAL`, `LEASE`.
- `NetSuite Nexus ID`: integer from the Nexus record URL.
- `NetSuite TaxType ID`: integer from the TaxType record URL. Verify this TaxType is associated with the same Nexus.
- `NetSuite TaxAgency Vendor ID`: integer from the Vendor record URL. The vendor must have Category = "Tax agency". Pick a real agency vendor (e.g., "CDTFA" for California), not a placeholder.

### Section D — Verification before kickoff

Confirm each of the following before the pilot sync runs:

- [ ] All listed Nexus records exist and are active in NetSuite.
- [ ] All listed TaxType records exist and are active.
- [ ] All listed TaxAgency vendors exist, have Category = "Tax agency", and are scoped to the right subsidiary.
- [ ] The SuiteTalk integration role has Create permission on `SalesTaxItem` and `TaxGroup`.
- [ ] You're ready to sync a small test invoice and verify the auto-created records look right in NetSuite UI.

### Section E — Operational

- [ ] Primary contact for the pilot (name, email, timezone).
- [ ] On-call window for the first 48 hours of sync.
- [ ] Expected invoice volume during the pilot window.
- [ ] Any custom NetSuite scripts / workflows that might interact with new SalesTaxItem / TaxGroup records? (Flag these — they're potential failure modes.)

---

## 10. Risks & Rollback

### 10.1 Risks specific to this implementation

| #   | Risk                                                                                             | Mitigation                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| I1  | SOAP `SalesTaxItem` / `TaxGroup` schema in our dataclasses doesn't exactly match NetSuite's WSDL | Verify against authenticated WSDL pull during PR-A1; sandbox testing catches mismatches before pilot                 |
| I2  | DUP_RCRD recovery races: two concurrent syncs create the same name                               | Re-fetch by name after DUP_RCRD; winner-take-all is correct because both syncs would have generated the same content |
| I3  | Cache mutation during sync introduces test flakiness                                             | Append-only is deterministic; tests assert final cache state, not intermediate                                       |
| I4  | Hash collisions across distinct compositions                                                     | 2⁻⁶⁴ probability; effectively zero. See PRD §4.4 risk analysis.                                                      |
| I5  | Customer's NetSuite has unusual character encoding in record names                               | Sanitize at the naming-helper boundary; names use only `[A-Z0-9_]+.0-9`                                              |
| I6  | Rate precision differs between Avalara and NetSuite stored rate                                  | 4dp truncation matches typical NetSuite display precision; `RATE_MISMATCH` tolerance is 0.0001 (one basis point)     |

### 10.2 Rollback

| Phase | Rollback path                                                                                                                 | Side effect                                                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Revert F1 + F2 PRs                                                                                                            | None — types-only changes                                                                                                               |
| 1     | Revert A1-A4 PRs OR set `provider: manual` on all opted-in connectors                                                         | Auto-create branch disabled; manual flow resumes                                                                                        |
| 2     | N/A — phase skipped (§5.3)                                                                                                    | —                                                                                                                                       |
| 3+    | Set `provider: manual` on pilot tenant; existing auto-created `ZN_*` records remain in NetSuite as orphaned-but-harmless data | Tenant tax sync falls back to lookup-or-fail; if they don't have manual mappings, they go back to failing the way they did before pilot |

No data corruption in any rollback path. Auto-created records stay
in NetSuite (can't be deleted if referenced by transactions); a
re-rollout would adopt them via DUP_RCRD recovery.

---

## 11. Timeline Summary

| Phase                     | Effort                     | Calendar            |
| ------------------------- | -------------------------- | ------------------- |
| 0 — Foundation            | 3 engineer-days (parallel) | Day 1-2             |
| 1 — Connector auto-create | 11 engineer-days           | Week 1-2            |
| 2 — Backend wiring        | 3 engineer-days            | Week 1-2 (parallel) |
| 3 — Integration + sandbox | 8 engineer-days            | Week 3              |
| 4 — Pilot + GA            | 5 engineer-days + ongoing  | Week 4              |

**Total: ~28 engineer-days** distributed across two engineers,
fitting comfortably in **3-4 calendar weeks** with one week of
buffer for sandbox bug-fix and pilot extension.

---

## 12. References

PRD and design docs:

- [netsuite-avalara-tax-sync-prd.md](netsuite-avalara-tax-sync-prd.md) — v1 PRD
- [netsuite-tax-implementation-plan.md](netsuite-tax-implementation-plan.md) — original lookup-or-fail manual flow plan (shipped as PRs #923, #924)

NetSuite Legacy Tax documentation:

- [Tax Codes Overview](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1805593.html)
- [Tax Groups Overview](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1809948.html)
- [Tax Types Overview](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1810558.html)
- [Creating Tax Codes — U.S. Nexus](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2039577.html)
- [Creating a Tax Group (United States)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2039890.html)
- [Sales Tax Item SOAP record](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N3754277.html)
- [Tax Group SOAP record](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N3755021.html)
- [Setting Up Nexuses in SuiteTax](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4296038572.html) — also describes Nexus fields used in Legacy

Internal:

- [connectors/netsuite/](../connectors/netsuite/) — connector root
- [connectors/netsuite/application/tax_resolution_service.py](../connectors/netsuite/application/tax_resolution_service.py) — file to be extended in PR-A3
- [connectors/netsuite/client/operations/tax.py](../connectors/netsuite/client/operations/tax.py) — existing read operations; reused for DUP_RCRD recovery
- [connectors/xero/tax_distribution.py](../connectors/xero/tax_distribution.py) — source of `derive_avalara_tax_group_key`, promoted to `mappers/tax_naming.py` in PR-F1
- [netsuite-tax-sandbox-smoke.md](netsuite-tax-sandbox-smoke.md) — existing sandbox setup; extended in §7

Codebase conventions:

- `logging` skill — structured logging (`event_name`, intent/look-ahead, ConnectorResponse audit split)
- [docs/architecture/tax-domain.md](../docs/architecture/tax-domain.md) — bounded-context rules
- [docs/architecture/error-handling-netsuite.md](../docs/architecture/error-handling-netsuite.md) — NetSuite error handling patterns
