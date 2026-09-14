-- The trade list, PRD F6's nineteen, in the PRD's order: the trades first, then
-- the professionals. The first reference data in the schema, and the answer to
-- how reference data is seeded (#106): **in a migration**, not by the seed
-- script #34 builds. `docs/data-model.md` §6 has the reasons at length; the
-- short version is that these rows are part of the schema's contract rather
-- than content — `contact_tags` cannot hold a row without one — so they arrive
-- wherever the schema does, and a change to them is reviewed as SQL and kept in
-- the migration history like any other change to the schema.
--
-- `capital_item_types` (#109) follows the same answer.
--
-- A plain insert, not `on conflict do nothing`: a migration runs once per
-- database, and a slug already present would mean something wrote this table
-- that should not have, which is worth an error. Adding a trade later is a new
-- migration with its own insert; relabelling one is an update there. Removing
-- one is refused while anybody is tagged with it (`restrict`, §7).
--
-- Steps of ten in `sort_order`, so a new trade can land between two.
INSERT INTO trade_tags (slug, label, sort_order) VALUES
  ('handyman',           'Handyman',                 10),
  ('general-contractor', 'General contractor',       20),
  ('hvac',               'HVAC',                     30),
  ('plumber',            'Plumber',                  40),
  ('electrician',        'Electrician',              50),
  ('roofer',             'Roofer',                   60),
  ('painter',            'Painter',                  70),
  ('landscaper',         'Landscaper',               80),
  ('snow-removal',       'Snow removal',             90),
  ('pest-control',       'Pest control',            100),
  ('turnover-cleaner',   'Turnover cleaner',        110),
  ('locksmith',          'Locksmith',               120),
  ('chimney',            'Chimney',                 130),
  ('appliance-repair',   'Appliance repair',        140),
  ('realtor',            'Realtor / leasing agent', 150),
  ('property-manager',   'Property manager',        160),
  ('cpa',                'CPA',                     170),
  ('attorney',           'Attorney',                180),
  ('inspector',          'Inspector',               190);
