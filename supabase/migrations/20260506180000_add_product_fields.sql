alter table if exists products
  add column if not exists category text null,
  add column if not exists unit text null,
  add column if not exists barcode text null,
  add column if not exists image_url text null;
