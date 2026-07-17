alter table public.words
  add constraint words_translation_contains_russian_check
  check (translation ~ '[А-Яа-яЁё]');
