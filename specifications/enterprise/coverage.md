# Enterprise feature coverage — DBLogistics-OS

Reviewed Elvora reference: `19d333806a044f194d50f624d87d0a4b6d434ffc`. Review date: 9 October 2026.

All 147 reference areas are retained in this ledger. “Partial foundation” means related implementation exists; it does not mean the complete requested enterprise capability works. Candidate source paths and acceptance gates are recorded in [coverage.json](coverage.json). The original reference specification remains in Elvora’s `src/shared/enterprise-scope.json`.

Elvora’s register reports 137 partial areas, six missing areas and four requiring external validation. That reference is a scope catalogue, not evidence that a production system satisfies the scope. Neither repository is presently a complete enterprise platform.

| ID | Feature area | DBLogistics assessment | Priority | Workstream |
|---|---|---|---|---|
| 1 | Corporate Administration | partial foundation | P1 | Organization & identity |
| 2 | Enterprise Identity & Security | partial foundation | P0 | Organization & identity |
| 3 | Enterprise User Roles | partial foundation | P0 | Organization & identity |
| 4 | Owner / CEO Command Center | partial foundation | P1 | Management & analytics |
| 5 | Executive Exception Center | partial foundation | P1 | Management & analytics |
| 6 | CRM | partial foundation | P1 | Commercial & procurement |
| 7 | Customer 360° | partial foundation | P1 | Commercial & procurement |
| 8 | Customer Onboarding | partial foundation | P1 | Commercial & procurement |
| 9 | KYC / Compliance | partial foundation | P1 | Commercial & procurement |
| 10 | Key Account Management | partial foundation | P1 | Commercial & procurement |
| 11 | Pricing Department | partial foundation | P1 | Commercial & procurement |
| 12 | Tariff Management | partial foundation | P1 | Commercial & procurement |
| 13 | Carrier RFQ | partial foundation | P1 | Commercial & procurement |
| 14 | Rate Intelligence | partial foundation | P1 | Commercial & procurement |
| 15 | Quotations | partial foundation | P1 | Commercial & procurement |
| 16 | Margin Controls | partial foundation | P1 | Commercial & procurement |
| 17 | Booking Management | partial foundation | P1 | Commercial & procurement |
| 18 | Master Job / House Job | partial foundation | P1 | Freight execution |
| 19 | Freight Departments | partial foundation | P1 | Freight execution |
| 20 | Shipment / Job Record | partial foundation | P1 | Freight execution |
| 21 | Separate Status Models | partial foundation | P0 | Freight execution |
| 22 | Routing Engine | partial foundation | P1 | Freight execution |
| 23 | Ocean Freight | partial foundation | P1 | Freight execution |
| 24 | Air Freight | partial foundation | P1 | Freight execution |
| 25 | Road Freight | partial foundation | P1 | Freight execution |
| 26 | NVOCC / Consolidation | not implemented | P1 | Freight execution |
| 27 | Containers | partial foundation | P1 | Freight execution |
| 28 | Detention / Demurrage | partial foundation | P1 | Freight execution |
| 29 | Container Deposit | partial foundation | P1 | Freight execution |
| 30 | BL / AWB Engine | partial foundation | P1 | Freight execution |
| 31 | Original Document Custody | partial foundation | P1 | Freight execution |
| 32 | Documentation Department | partial foundation | P1 | Freight execution |
| 33 | Manifest Management | partial foundation | P1 | Freight execution |
| 34 | Customs | partial foundation | P1 | Trade & regulatory |
| 35 | Customs Integration Layer | partial foundation | P1 | Trade & regulatory |
| 36 | MPCI / Future Compliance Requirements | not implemented | P1 | Trade & regulatory |
| 37 | Dangerous Goods | partial foundation | P1 | Freight execution |
| 38 | Reefer / Cold Chain | partial foundation | P1 | Freight execution |
| 39 | Project Cargo | partial foundation | P1 | Freight execution |
| 40 | Insurance | partial foundation | P1 | Freight execution |
| 41 | Claims | partial foundation | P1 | Freight execution |
| 42 | Transport Management | partial foundation | P1 | Freight execution |
| 43 | Dispatch Board | partial foundation | P1 | Freight execution |
| 44 | Driver Application | not implemented | P1 | UX & mobile |
| 45 | Fleet | partial foundation | P1 | Freight execution |
| 46 | Warehouse Management | partial foundation | P1 | Warehouse |
| 47 | Advanced Warehouse | partial foundation | P1 | Warehouse |
| 48 | Barcode / QR | partial foundation | P1 | Warehouse |
| 49 | Warehouse Billing | partial foundation | P1 | Warehouse |
| 50 | Vendor / Carrier / Agent Management | partial foundation | P1 | Commercial & procurement |
| 51 | Vendor Onboarding | partial foundation | P1 | Commercial & procurement |
| 52 | Vendor Performance | partial foundation | P1 | Commercial & procurement |
| 53 | Overseas Agent Management | partial foundation | P1 | Commercial & procurement |
| 54 | Job Costing | partial foundation | P0 | Freight execution |
| 55 | Cost Allocation | partial foundation | P1 | Freight execution |
| 56 | Accrual Accounting | partial foundation | P1 | Finance |
| 57 | WIP / Revenue Recognition | partial foundation | P1 | Finance |
| 58 | Double-Entry Accounting | partial foundation | P0 | Finance |
| 59 | Accounts Receivable | partial foundation | P1 | Finance |
| 60 | Accounts Payable | partial foundation | P1 | Finance |
| 61 | Credit Control | partial foundation | P0 | Finance |
| 62 | Credit Limits | partial foundation | P1 | Finance |
| 63 | Treasury | partial foundation | P1 | Finance |
| 64 | Cheque / PDC | partial foundation | P1 | Finance |
| 65 | Bank Reconciliation | partial foundation | P1 | Finance |
| 66 | Multicurrency | partial foundation | P1 | Finance |
| 67 | UAE VAT | partial foundation | P1 | Trade & regulatory |
| 68 | UAE e-Invoicing | partial foundation | P1 | Trade & regulatory |
| 69 | Corporate Tax Support | partial foundation | P1 | Trade & regulatory |
| 70 | Fixed Assets | partial foundation | P1 | Finance |
| 71 | Budgeting | partial foundation | P1 | Finance |
| 72 | Financial Consolidation | not implemented | P1 | Finance |
| 73 | Procurement | partial foundation | P1 | Commercial & procurement |
| 74 | Operational Advances | partial foundation | P1 | Finance |
| 75 | Approval Engine | partial foundation | P0 | Workflow & work |
| 76 | Workflow Engine | partial foundation | P1 | Workflow & work |
| 77 | SLA Engine | partial foundation | P1 | Workflow & work |
| 78 | Department Work Queues | partial foundation | P1 | Workflow & work |
| 79 | Workload Management | partial foundation | P1 | Workflow & work |
| 80 | Shift Handover | partial foundation | P1 | Workflow & work |
| 81 | Customer SOP Engine | partial foundation | P1 | Freight execution |
| 82 | Route / Lane SOP | partial foundation | P1 | Freight execution |
| 83 | Workflow Templates | partial foundation | P1 | Workflow & work |
| 84 | Cut-Off Management | partial foundation | P1 | Freight execution |
| 85 | Pre-Alert Automation | partial foundation | P1 | Freight execution |
| 86 | Unified Inbox | not implemented | P1 | Communications & partners |
| 87 | WhatsApp Business | partial foundation | P1 | Communications & partners |
| 88 | WhatsApp Automation | partial foundation | P1 | Communications & partners |
| 89 | Daily Owner WhatsApp Brief | partial foundation | P1 | Communications & partners |
| 90 | Email Automation | partial foundation | P1 | Communications & partners |
| 91 | Communication Timeline | partial foundation | P1 | Communications & partners |
| 92 | Universal Side Panel | partial foundation | P1 | Communications & partners |
| 93 | Document Management | partial foundation | P0 | Communications & partners |
| 94 | OCR | partial foundation | P1 | Communications & partners |
| 95 | Document Matching | partial foundation | P1 | Communications & partners |
| 96 | Customer Portal | partial foundation | P1 | Communications & partners |
| 97 | Agent Portal | not implemented | P1 | Communications & partners |
| 98 | Vendor Portal | not implemented | P1 | Communications & partners |
| 99 | Employee Portal | partial foundation | P1 | Communications & partners |
| 100 | HRMS | partial foundation | P2 | People & quality |
| 101 | UAE Payroll | partial foundation | P2 | Finance |
| 102 | WPS | partial foundation | P2 | Trade & regulatory |
| 103 | EOSB | partial foundation | P2 | Finance |
| 104 | Employee Documents | partial foundation | P2 | People & quality |
| 105 | Training & Competency | partial foundation | P2 | People & quality |
| 106 | Knowledge Base | partial foundation | P2 | People & quality |
| 107 | Internal Helpdesk | partial foundation | P2 | People & quality |
| 108 | Customer Helpdesk | partial foundation | P2 | People & quality |
| 109 | Complaint Management | partial foundation | P2 | People & quality |
| 110 | Quality Management | partial foundation | P2 | People & quality |
| 111 | HSE | partial foundation | P2 | People & quality |
| 112 | Compliance Calendar | partial foundation | P2 | Trade & regulatory |
| 113 | Risk Register | partial foundation | P2 | People & quality |
| 114 | Audit Module | partial foundation | P2 | People & quality |
| 115 | Immutable Audit Trail | partial foundation | P0 | People & quality |
| 116 | Reports | partial foundation | P2 | Management & analytics |
| 117 | Profitability Analytics | partial foundation | P2 | Management & analytics |
| 118 | Staff Productivity | partial foundation | P2 | Management & analytics |
| 119 | Carrier Performance | partial foundation | P2 | Management & analytics |
| 120 | Customer Churn / Growth | partial foundation | P2 | Management & analytics |
| 121 | Report Builder | not implemented | P2 | Management & analytics |
| 122 | Scheduled Reports | partial foundation | P2 | Management & analytics |
| 123 | BI Layer | not implemented | P2 | Management & analytics |
| 124 | Universal Search | partial foundation | P2 | Management & analytics |
| 125 | EDI | partial foundation | P2 | Communications & partners |
| 126 | Integration Hub | partial foundation | P2 | Communications & partners |
| 127 | Integration Monitoring | partial foundation | P2 | Communications & partners |
| 128 | API Platform | partial foundation | P0 | Communications & partners |
| 129 | AI Operations Copilot | partial foundation | P2 | AI |
| 130 | AI Pricing Assistant | partial foundation | P2 | AI |
| 131 | AI Documentation QA | partial foundation | P2 | AI |
| 132 | AI Finance Analyst | partial foundation | P2 | AI |
| 133 | AI Management Analyst | partial foundation | P2 | AI |
| 134 | AI Guardrails | partial foundation | P0 | AI |
| 135 | Master Data Governance | partial foundation | P2 | Commercial & procurement |
| 136 | Data Quality | partial foundation | P2 | Commercial & procurement |
| 137 | Job Closure | partial foundation | P0 | Freight execution |
| 138 | Controlled Reopening | partial foundation | P0 | Freight execution |
| 139 | Production Environments | partial foundation | P0 | Organization & identity |
| 140 | Backup & Disaster Recovery | partial foundation | P0 | Recovery & migration |
| 141 | Monitoring | partial foundation | P0 | Recovery & migration |
| 142 | Release Management | partial foundation | P0 | Organization & identity |
| 143 | Migration from Fresa | not implemented | P0 | Recovery & migration |
| 144 | UX — do NOT copy Fresa visually | partial foundation | P2 | UX & mobile |
| 145 | Staff Homepage | partial foundation | P2 | Management & analytics |
| 146 | Management Homepage | partial foundation | P2 | Management & analytics |
| 147 | Mobile | partial foundation | P2 | UX & mobile |

The current [work control and governance delivery](work-control.md) adds verified local workflows for identity/roles, SLA calendars, department queues, workload, handover, templates, knowledge, risk and service health. Detailed delivery evidence is attached to the corresponding entries in the JSON ledger. All 147 remain subject to their complete acceptance gates.
