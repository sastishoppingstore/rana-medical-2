# Project overview — Rana Medical Hospital

## Application structure

```text
.
├── index.html                 Responsive public website + ERP interface
├── server.js                  Node HTTP API, JSON demo persistence, SSE
├── backend/
│   └── policies.js            ERP role-resource matrix + form schema metadata
├── database/
│   ├── schema.sql             PostgreSQL relational schema starter
│   └── seed.sql               Safe reference-only seed data
├── tests/
│   └── workflows.test.js      API workflow integration tests
├── hospital-care.jpg          Generated editorial-style hospital image
├── package.json               Run/test scripts (zero npm dependencies)
├── .env.example               Future integration configuration template
└── README.md                  Setup, API notes, limits and deployment checklist
```

## Integrated demo journeys

- **Appointment:** public booking → API validation → reference + OPD token → persisted queue → role-authorized ERP view → SSE refresh.
- **Doctor directory:** Super Admin demo role → add/edit/archive doctor → shared store → public directory and appointment finder refresh.
- **IPD:** select an available sample bed → admission marks bed occupied → discharge computes a sample room charge and invoice → bed returns to available.
- **Pharmacy:** pharmacist selects a medicine and quantity → stock check → stock decrement → sale, invoice and payment record.
- **Lab:** authorized role creates a sample order → result entry → separate publish confirmation → reference + registered-mobile verification returns the synthetic report only.
- **Accounts:** record a partial payment against an invoice; overpayments are rejected; dashboard revenue, expenses and net are based on entered demo transactions, with finance totals hidden from non-finance roles.
- **CMS:** publish services, packages, articles and FAQs → public content endpoint → site refresh via generic event stream.
- **Operations:** authorized role-based CRUD, edit and soft-archive patterns for configured resource collections; printable record views.

## Implementation boundaries

The current demo store is a local JSON document for easy exploration; it is not a concurrent production database and is not connected to `DATABASE_URL`. The PostgreSQL DDL is a starting schema, not a migration run by the application. The six roles are selected in a demo-only session and are not authenticated personnel identities. Some ERP entities are generic CRUD prototypes, and full prescription-to-POS integration, nurse medication administration, surgical supplies, procurement receiving, payroll calculations, SMS/WhatsApp delivery, complete report PDFs/QR signing, hospital location/configuration, and genuine privacy/security controls remain to be implemented and validated before live use.
