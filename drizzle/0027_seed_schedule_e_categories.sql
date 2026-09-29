-- The expense lines of Schedule E (Form 1040), Part I, lines 5 through 19,
-- that a recorded expense can land on. Seeded in a migration for `0013`'s
-- reasons: `transactions` cannot hold a row without one, so these are part of
-- the schema's contract rather than content, and a change to them is reviewed
-- as SQL.
--
-- **Line 18, depreciation, is left out.** The tax planner computes it from each
-- building's basis; nobody pays it, so nobody records it.
--
-- The labels are the form's, shortened where the form's words are a sentence:
-- line 12 is "Mortgage interest paid to banks, etc." on the form, and line 10
-- "Legal and other professional fees". A plain insert, not `on conflict do
-- nothing`, for `0013`'s reason.
INSERT INTO schedule_e_categories (slug, label, line) VALUES
  ('advertising',        'Advertising',                 5),
  ('auto-and-travel',    'Auto and travel',             6),
  ('cleaning',           'Cleaning and maintenance',    7),
  ('commissions',        'Commissions',                 8),
  ('insurance',          'Insurance',                   9),
  ('professional-fees',  'Legal and professional fees', 10),
  ('management-fees',    'Management fees',            11),
  ('mortgage-interest',  'Mortgage interest',          12),
  ('other-interest',     'Other interest',             13),
  ('repairs',            'Repairs',                    14),
  ('supplies',           'Supplies',                   15),
  ('taxes',              'Taxes',                      16),
  ('utilities',          'Utilities',                  17),
  ('other',              'Other',                      19);
