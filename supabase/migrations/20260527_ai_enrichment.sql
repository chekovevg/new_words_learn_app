alter table public.words
  add column if not exists source text,
  add column if not exists confidence double precision;
