alter table public.words
  add constraint words_language_not_russian_check
  check (
    lower(regexp_replace(trim(replace(language, chr(160), ' ')), '\s+', ' ', 'g')) <> 'russian'
  );
