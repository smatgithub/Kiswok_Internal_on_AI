# Kiswok Internal Portal V3

Greenfield next generation of Kiswok Internal portals.

**Stack:** Next.js (App Router) + NestJS API + SQL Server (IcSoft)  
**Auth:** Same V2 identity — Nest BFF proxies `Internal-API` `/api/kiswok/auth/*` (username/password + MFA)

## Phase 1 feature: SAP Item Code Creation (ZRAW)

Guided workflow to replicate selected IcSoft items into an SAP S/4HANA Cloud Migration Cockpit **Product** template — without dumping every duplicate into SAP.

### Flow

1. Search ERP candidates (items not yet in `sap_new_item_master`)
2. Step wizard with defaults from ERP SQL + mapping rules
3. Preview → commit line into a batch
4. Edit committed rows in grid / copy previous config
5. Export gold-template-compatible SpreadsheetML XML (`Gold_SAP_Template - ZRAW.xml`)

### Gold assets

- [`assets/templates/Gold_SAP_Template - ZRAW.xml`](assets/templates/Gold_SAP_Template%20-%20ZRAW.xml)
- [`assets/templates/SAP Item Template column Mapping data.xlsx`](assets/templates/SAP%20Item%20Template%20column%20Mapping%20data.xlsx)

> Export format is **Excel XML Spreadsheet 2003** (same as SAP Migration Cockpit gold file). Open in Excel or upload to Migration Cockpit as-is.

## Repo layout

```
apps/web     Next.js UI
apps/api     NestJS API (BFF + SAP/IcSoft modules)
packages/shared   Shared types
assets/templates  Gold SAP template + mapping workbook
```

## Authentication (V2 parity)

```
Browser  →  Nest /api/auth/*  →  Internal-API /api/kiswok/auth/*
                │
                └─ JwtAuthGuard on /sap-items, /icsoft-items
                   (verifies access JWT with shared JWT_SECRET)
```

| V3 endpoint | Proxies to |
|-------------|------------|
| `POST /api/auth/login` | `POST /kiswok/auth/login` |
| `POST /api/auth/verify-otp` | `POST /kiswok/auth/verifyOTP` |
| `POST /api/auth/forgot-password` | `GET /kiswok/auth/forget-password` |
| `POST /api/auth/reset-password` | `POST /kiswok/auth/reset-request` |
| `GET /api/auth/me` | JWT decode (local) |

- Same `EmpLoginDetails` users / passwords as V2
- Access token stored in `localStorage` (`token`, `userInfo`) — same contract as V2 for gradual page migration
- Login UI: `/login` (MFA + forgot/reset supported)

Required env (copy `JWT_SECRET` from Internal-API `.env`):

```bash
# Reachable Internal-API (office VPN / hosts DNS may be required for testv2)
INTERNAL_API_URL=https://testv2.kiswok.com/api
# Local Internal-API (HTTPS self-signed on SSL_PORT):
# INTERNAL_API_URL=https://localhost:4001/api
# INTERNAL_API_TLS_INSECURE=true
JWT_SECRET=...                                   # must match Internal-API
```

Login depends on Internal-API → SQL (`EmpLoginDetails` in `indb`). If Internal-API’s `DB_SERVER` host does not resolve, fix VPN/DNS or point that API at a reachable SQL host — V3 does not store a second password database.

## Setup

```bash
cd /Volumes/Som_SSD_T7/Workspace/Kiswok_Internal_on_AI
cp .env.example .env
# Edit DB_* + INTERNAL_API_URL + JWT_SECRET
npm install
npm run build -w @kiswok/shared
```

### Run API

```bash
npm run dev:api
# http://localhost:4010/api/health
```

### Run Web

```bash
npm run dev:web
# http://localhost:3000 → redirects to /login when unauthenticated
```

## ERP SQL

Candidate query lives in `apps/api/src/modules/sap-item/queries.ts` (your provided ZRAW candidate SQL, search-wrapped).

## ERP SQL connection (Internal-Site / Internal-API aligned)

### Internal-Site (`utility/databaseServer.js`)
- Host: `INDBIP`
- User/Pass: `DBUSER` / `DBPASS`
- Database: `ICSOFTDB` (icsoft)
- Driver: Sequelize + mssql/tedious, requestTimeout 300000

### Internal-API (`src/config/dbConfig.js`)
- Host: `DB_SERVER`
- User/Pass: `DB_USER` / `DB_PASS`
- Driver: `mssql` ConnectionPool per database name

### V3 (`apps/api`)
Uses Internal-API variable names, with Internal-Site aliases as fallback:
`DB_SERVER|INDBIP`, `DB_USER|DBUSER`, `DB_PASS|DBPASS`, `DB_NAME|ICSOFTDB`

Check: `GET /api/health/db`


| Version | Path / repo |
|---------|-------------|
| V2 Front-end | `KiswokInternalV2/Front-end` → `Kiswok-IT/Internal-React-Frontend` |
| V2 API | `KiswokInternalV2/Internal-API` → `Kiswok-IT/Internal-API` |
| V1 | `KiswokInternalV2/InternalV1/Internal-Site` → `Kiswok-IT/Internal-Site` |

Other modules will be migrated into this V3 monorepo page-by-page — auth is ready so each page can reuse the same login.
