# CodeAlpha_DataRedundancy

A cloud-hosted data redundancy removal system built for the CodeAlpha Cloud Computing internship (Task 1).
Every incoming record is validated and checked against the existing database. Only unique, verified records are appended, so the database stays accurate and free of duplicates.

## How records are classified

| Result | Meaning | Stored? | HTTP |
|---|---|---|---|
| `unique` | No match found. | Yes | 201 |
| `redundant` | A verified duplicate: same email, same phone, or a very similar name in the same city. | No | 409 |
| `false_positive` | The name looked like a duplicate, but verification showed email, phone and city all differ, so it is a different person. | Yes | 201 |
| `invalid` | Failed validation (bad email, malformed phone, junk or injection characters in the name or city). | No | 400 |

Note on terminology: the brief asks the system to classify data as "redundant or false positive". This project treats a false positive as a record the similarity check flagged as a possible duplicate but that verification proved to be distinct, so it is correctly kept instead of being wrongly thrown away.

## How the check works

1. **Validation** (`validation.js`): only well-formed records continue.
2. **Normalization** (`normalize.js`): emails are lowercased and Gmail dots and `+tags` are removed, phone numbers are reduced to their last 10 digits, and names are lowercased with their words sorted. `AARAV.MEHTA@EXAMPLE.COM` and `aarav.mehta@example.com` become the same value.
3. **Stage 1, exact match** (`dedup.js`): an indexed lookup on normalized email and phone. A hit means `redundant`.
4. **Stage 2, fuzzy match**: edit-distance similarity on the name, only against records in the same name block (first two letters), so the whole table is never scanned.
5. **Stage 3, verification**: a similar name in the same city is `redundant`. A similar name with a different city, email and phone is `false_positive`.
6. **Append**: verified records are inserted. The database `UNIQUE` keys on normalized email and phone are the final guarantee, so even simultaneous identical requests store only one copy.
7. **Audit log**: every submission and its classification is recorded in `intake_log`.

## Endpoints

All except `/health` need the header `x-api-key: <API_KEY>`.

- `POST /records` body: `{ "fullName", "email", "phone" (optional), "city" }`
- `POST /records/bulk` body: `{ "records": [ ... up to 100 ... ] }` returns a summary and per-record results
- `GET /records` stored records
- `GET /stats` counts per classification
- `GET /log` recent classification log
- `GET /health`

## Run locally

```bash
npm install
cp .env.example .env     # fill in DB details and API_KEY
mysql -h <host> -u <user> -p < schema.sql
npm start
npm test
```

## Demo with sample data

`sample-data/bulk.json` holds 12 records that include exact duplicates, case and format variants, a Gmail variant, a similar name in a different city, and invalid rows. On an empty database the expected summary is: 4 unique, 1 false positive, 5 redundant, 2 invalid (5 stored).

```bash
curl -s -X POST http://localhost:3001/records/bulk \
  -H "Content-Type: application/json" -H "x-api-key: $API_KEY" \
  -d @sample-data/bulk.json
```

To reset the data before running it again: `TRUNCATE records; TRUNCATE intake_log;`

## Deployment on AWS

Runs on an EC2 instance (port 3001) with a MySQL database on Amazon RDS. The database is private, and its security group accepts connections only from the application server's security group.

## Known limitations

- The fuzzy stage only compares names that share the same first two letters, so a typo in the first two letters is not caught by similarity. Duplicates with the same email or phone are still caught by the exact stage.
- A shared landline or family email would be treated as redundant, because phone and email are treated as unique per person.
- Two simultaneous submissions that differ in email and phone but have near-identical names in the same city can both be stored. Only email and phone are enforced by the database.
- Traffic is plain HTTP and access is controlled by a single shared API key. A production system would use HTTPS and per-user credentials.
