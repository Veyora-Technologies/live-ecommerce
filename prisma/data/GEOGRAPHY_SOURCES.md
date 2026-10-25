# Nigeria geography source and redistribution note

## Imported candidate dataset

- **Dataset:** Nigeria Subnational Administrative Boundaries (COD-AB)
- **Provider:** OCHA Humanitarian Data Exchange (HDX), Nigeria Information Management Working Group / OCHA FIS
- **Dataset page:** https://data.humdata.org/dataset/cod-ab-nga
- **Workbook resource:** https://data.humdata.org/dataset/81ac1d38-f603-4a98-804d-325c658599a3/resource/f1865f35-a07e-4de3-9183-e4222e475527/download/nga_admin_boundaries.xlsx
- **Contributing source agencies listed by HDX:** Office of the Surveyor General of the Federation (OSGOF), eHealth Africa, and the United Nations Cartographic Section (UNCS)
- **Dataset version:** COD-AB v01 (as identified in the workbook)
- **Dataset page review date recorded by HDX:** 2025-10-30
- **License recorded by HDX:** Creative Commons Attribution for Intergovernmental Organisations (CC BY-IGO)
- **Downloaded for this Furnivo workspace:** 2026-10-21
- **Files:** `nga_admin_boundaries.xlsx` (source workbook), `nigeria-geography.json` (normalized candidate seed records), generated reproducibly by `scripts/import_geography.py`.

## Scope and quality limits

The candidate import contains 36 state records, the distinct Federal Capital Territory (FCT), 774 admin-2 LGAs/area councils (including the six FCT area councils), and 38 city records as represented in the source capital sheet. The city sheet includes 36 state-capital-level records, an additional Lagos record, and Abuja. Because the source's capital-sheet levels and identifiers are not internally uniform, city records are a separate, lower-level convenience layer; **do not use them to infer or replace admin boundaries**. City rows with unusual names or coordinates must be checked against another licensed/authoritative source before operational use. P-code matching between the capitals sheet and admin-1/admin-2 sheets is intentionally not used.

Admin-3 ward records are partial (714, not a complete national set) and are not imported. This dataset must not be represented as a complete ward/locality gazetteer, a cadastral or legal boundary product, an address-validation source, proof of merchant coverage, or proof of current inventory. The source boundary data are older than the dataset page review date; the review date is source metadata, not a claim that Furnivo independently verified every feature.

Before production redistribution, legal/data owners should re-check the current resource license and attribution requirements, retain this notice, and confirm whether derivative JSON and any future boundary geometries can be redistributed under the applicable CC BY-IGO terms. The initial seed contains names, codes, source metadata, and selected source centroids only; it contains no user location or merchant data.

## IDs and hierarchy

- `NG` is the country identifier used by Furnivo (ISO 3166-1 alpha-2).
- Admin-1 and admin-2 Furnivo codes retain the source P-codes.
- City codes are Furnivo-generated stable identifiers scoped to a parent state/territory; they are not presented as OCHA P-codes.
- Parent-child assignments are generated from the source hierarchy and checked by the importer. The application API also validates codes and ancestry server-side.
- FCT remains a `TERRITORY` with six `AREA_COUNCIL` children; it is not modelled as a state.

## Attribution

Contains information from the United Nations Office for the Coordination of Humanitarian Affairs (OCHA) / Humanitarian Data Exchange (HDX) Nigeria COD-AB, version v01, with source agencies listed as OSGOF, eHealth Africa, and UNCS. Dataset page: https://data.humdata.org/dataset/cod-ab-nga. Licensed by HDX as CC BY-IGO. See the dataset page for the current license text and any subsequent version or resource changes.
