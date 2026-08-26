-- ============================================================
-- 09_seed_churches.sql — sample churches so signup has a list.
-- Official names / Amharic verified with the user (2026-08-03).
-- Idempotent UPSERT (fixed UUIDs) — safe to re-run; corrects prior rows.
-- VERIFY exact registered names + Amharic with each pastor before launch,
-- and note preferred English spellings (e.g. "Kale Heywet" vs "Kale Hiwot").
-- ============================================================

insert into churches (id, name_am, name_en, denomination, city) values
  ('a0000000-0000-4000-8000-000000000001', 'የኢትዮጵያ ወንጌላዊት ቤተ ክርስቲያን መካነ ኢየሱስ', 'Ethiopian Evangelical Church Mekane Yesus', 'Mekane Yesus',     'Addis Ababa'),
  ('a0000000-0000-4000-8000-000000000002', 'የኢትዮጵያ ቃለ ሕይወት ቤተ ክርስቲያን',          'Ethiopian Kale Heywet Church',             'Kale Heywet',      'Addis Ababa'),
  ('a0000000-0000-4000-8000-000000000003', 'የኢትዮጵያ ሙሉ ወንጌል አማኞች ቤተ ክርስቲያን',    'Ethiopian Full Gospel Believers'' Church', 'Mulu Wongel',      'Addis Ababa'),
  ('a0000000-0000-4000-8000-000000000004', 'መሠረተ ክርስቶስ ቤተ ክርስቲያን',              'Meserete Kristos Church',                  'Meserete Kristos', 'Addis Ababa'),
  ('a0000000-0000-4000-8000-000000000005', 'አማኑኤል ኅብረት ቤተ ክርስቲያን',              'Emmanuel United Church',                   'Emmanuel United',  'Addis Ababa'),
  ('a0000000-0000-4000-8000-000000000006', 'ሕይወት ብርሃን ቤተ ክርስቲያን',                'Hiwot Berhan Church',                      'Hiwot Berhan',     'Addis Ababa'),
  ('a0000000-0000-4000-8000-000000000007', 'የኢትዮጵያ ባፕቲስት አብያተ ክርስቲያናት',        'Ethiopian Baptist Churches',               'Baptist',          'Addis Ababa')
on conflict (id) do update set
  name_am      = excluded.name_am,
  name_en      = excluded.name_en,
  denomination = excluded.denomination,
  city         = excluded.city;

-- Example branches under Ethiopian Kale Heywet Church so the branch picker
-- isn't empty either. Replace with the pilot church's real branches.
insert into branches (id, church_id, name_am, name_en, is_mother_branch) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'ቦሌ ቅርንጫፍ',   'Bole Branch',      true),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'መገናኛ ቅርንጫፍ', 'Megenagna Branch', false)
on conflict (id) do update set
  church_id        = excluded.church_id,
  name_am          = excluded.name_am,
  name_en          = excluded.name_en,
  is_mother_branch = excluded.is_mother_branch;
