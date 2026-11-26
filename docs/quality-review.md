# Quality review and remaining submission work

## Improvements made in this revision

- GST is calculated in integer paise, with separate CGST/SGST for intra-state supply and IGST for inter-state supply. The split retains the complete rounded tax amount, including odd-paise cases.
- Financial-year invoice numbers use a row locked inside the invoice transaction. Concurrent invoice requests cannot allocate the same sequence number.
- Order entry, order edits, invoice totals and payments reject invalid or unsafe monetary values.
- Production validates whole-number damaged pouch counts and checks that pouch consumption covers good output plus damaged pouches.
- Dispatch accepts whole packet quantities only and rejects empty dispatch documents.
- Purchase quantities and rates are checked before ledger posting.
- BOM creation locks its parent product, validates units and quantities, and the schema enforces unique BOM versions and unique item rows per BOM.
- The benchmark runner checks expected stock, invoice, payment, shortage and cost figures before committing its demo transaction.
- A dependency-free verification command (`npm run verify`) checks six domain tests, JavaScript syntax, mounted route files, frontend local references and invoice-sequence schema wiring.

## Verified in this packaging environment

`npm run verify` completed successfully: 6 tests passed and the static project checks passed for 35 JavaScript files. These checks do not require MySQL or third-party packages.

## Still required before claiming a 98/100 submission

- Run the project against a real MySQL 8 instance and execute `npm run seed` followed by `npm run benchmark`.
- Run the complete Jest suite after `npm install` and add endpoint-level integration tests for login/role permissions, order approval, GST invoice, partial dispatch, payment limits and production rollback.
- Verify the mobile offline queue in an actual browser and test simultaneous invoice creation against MySQL.
- Record the required demonstration video (maximum 8 minutes), publish a Git repository with meaningful commits, and provide a working hosted link or reproducible run instructions.
- Have the tax invoice format and GST assumptions reviewed before any real-world use; demo GSTINs are placeholders.

A 98/100 result cannot be guaranteed by code changes alone. The NIT panel controls the final score, and the live database workflow, demo evidence, repository history and interview explanation remain important parts of the submission.
