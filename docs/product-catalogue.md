# Product and service catalogue

This is the first business automation module. Open **Products** in the sidebar
to browse products and services, search by name/code/category, and filter by
type or active/archived status. Owners and admins can add, edit, archive,
restore, and import items. Agents and viewers have read-only access.

## Database setup

Apply `supabase/migrations/061_product_catalogue.sql` followed by
`supabase/migrations/062_business_account_data_guard.sql` using the project's
normal migration process before using the module. Migration 061 adds the
`products` table, indexes, row-level access policies, and an update timestamp
trigger. It depends on the existing account membership helper and timestamp
function. Migration 062 extends the existing invitation safeguard so joining
another account cannot delete catalogue or invoice history (including migration
060's invoice delivery table). These do not enable new messaging behavior.

Each account has a separate catalogue. The API uses the signed-in user's
Supabase client and explicit account filters; database policies enforce the
same membership rules even when accessed directly. Permanent deletion is not
exposed. Archived items retain their codes and can be restored.

## Prices and availability

Prices are **before tax**, with a separate percentage rate from 0 to 100.
Amounts accept up to two decimal places and use Postgres decimal columns.
Supported currencies match the existing account currency picker. New items
default to the account currency; imports must specify their currency.
Availability is a manual indication, not tracked inventory or a reservation.
Images reference HTTPS URLs; the server does not fetch or upload those images.

## CSV import

Download the sample from `/samples/products.csv`. Import up to 500 rows / 1 MB.
Required columns are `name`, `unit_price`, and `currency`. Optional columns:
`sku`, `kind`, `category`, `description`, `specifications`, `image_url`, `unit`,
`tax_rate`, `availability`. Use `product` or `service` for kind and `available`,
`on_request`, or `unavailable` for availability. Quoted commas, multiline text,
escaped double quotes, and UTF-8 BOMs are supported. Prices have no grouping
separator. Codes are case-insensitive and unique within an account, including
archived items. Blank codes are allowed.

Imports add new items; they never overwrite existing records. Every row is
validated before one atomic database insert. Any invalid row or code conflict
rejects the entire file. Error record numbers include the header and exclude
blank records; embedded newlines do not increment the record number.

## Internal API

All endpoints require the normal dashboard session, not a public API key:

- `GET /api/products?q=&kind=all&status=active&page=1`: 25 results per page.
- `POST /api/products`: create an item (admin/owner).
- `PUT /api/products/:id`: replace editable item fields (admin/owner).
- `PATCH /api/products/:id`: archive/restore with `{ "is_active": false/true }`.
- `POST /api/products/import`: multipart `file` containing CSV (admin/owner).

Catalogue items power the [quotation workflow](./quotations.md), including AI
quotation intake. General AI replies continue to use the existing knowledge
base; quotation prices are calculated from structured catalogue records.
