-- Upgrade: adiciona colunas opcionais para produtos (categoria, unit, barcode, image_url)
alter table if exists produtos add column if not exists categoria text;
alter table if exists produtos add column if not exists codigo text;
alter table if exists produtos add column if not exists image_url text;
-- Recomenda-se executar no SQL Editor do Supabase ou via CLI
