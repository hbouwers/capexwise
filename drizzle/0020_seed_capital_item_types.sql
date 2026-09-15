-- The capital item catalogue: the add-equipment checklist's twenty-seven
-- types, in its five groups and its order (`docs/ui/screens/modal-add-
-- equipment.md`), each with one national default life and cost (PRD §12,
-- question 4). Seeded in a migration, as `0013` seeds the trades, for the
-- reasons `docs/data-model.md` §6 gives: every org reads these rows, a screen
-- cannot work without them, and a refresh is a diff somebody reviews.
--
-- **A refresh moves nobody's numbers.** Every default is copied onto an item
-- when the item is added (§5), so a later migration that corrects a life or a
-- cost changes what the next item starts with and nothing already entered. It
-- updates `defaults_updated_at` on the rows it touches, which is the date the
-- modal shows beside them.
--
-- ## Where the lives come from
--
-- **Fannie Mae, Instructions for Performing a Multifamily Property Condition
-- Assessment (Version 2.0), Appendix F: Estimated Useful Life Tables** — Form
-- 4099.F, 10/14. The "Multifamily / Coop" column: it is a lender's table for
-- rented buildings, which is the wear these items get. Where a row gives a
-- range, its midpoint rounded up; where it gives "50+", fifty.
--
-- Where Fannie Mae has no row, the **NAHB / Bank of America Home Equity Study
-- of Life Expectancy of Home Components**, February 2007, Table 1 — which is
-- about owner-occupied homes, so it is the second source and not the first.
--
-- ## Where the costs come from
--
-- **Angi's 2026 national cost guides** (angi.com/articles), which report an
-- average from completed projects: its national average where it states one,
-- the midpoint of its typical range where it does not. Appliances from
-- **HomeGuide's 2026 guides** (homeguide.com/costs), which price the unit and
-- its replacement labour apart: the midpoints of both, added. Every figure is
-- then rounded to the nearest hundred dollars, a half rounding up.
--
-- A unit-scoped cost is one unit's worth, and a building-scoped one is the
-- whole building's. Where the source prices by the square foot, the area is
-- a unit of about 1,000 sq ft: carpet in the bedrooms, about 400 of it, and
-- hard flooring in the rest. The comment on each row says which figure it
-- took. These are starting points for somebody who has not read the labels
-- yet; the item is theirs to correct the moment it is added.
--
-- A plain insert, not `on conflict do nothing`, for `0013`'s reason. Steps of
-- ten in `sort_order`, across the whole catalogue, so a type added later can
-- land between two and the groups keep their order.
INSERT INTO capital_item_types
  (slug, label, item_group, default_scope, default_life_years,
   default_cost_cents, defaults_updated_at, sort_order)
VALUES
  -- Kitchen
  -- FM "Kitchen: Refrigerator" 10. HomeGuide, installed, $675–$2,500.
  ('refrigerator',       'Refrigerator',          'kitchen',          'unit',     10,   160000, '2026-09-15',  10),
  -- FM "Kitchen: Range" 15. HomeGuide, unit $600–$1,300 and labour $100–$300.
  ('range',              'Range / oven',          'kitchen',          'unit',     15,   120000, '2026-09-15',  20),
  -- FM "Kitchen: Dishwasher" 5–10. Angi, installed, average $1,200.
  ('dishwasher',         'Dishwasher',            'kitchen',          'unit',      8,   120000, '2026-09-15',  30),
  -- FM "Kitchen: Microwave" and "Kitchen: Range-hood", both 10. Angi,
  -- over-the-range microwave installed, $250–$1,200.
  ('microwave-hood',     'Microwave / hood',      'kitchen',          'unit',     10,    70000, '2026-09-15',  40),
  -- NAHB "Disposers, Food Waste" 12. Angi, replaced, average $550.
  ('garbage-disposal',   'Garbage disposal',      'kitchen',          'unit',     12,    60000, '2026-09-15',  50),
  -- FM "Kitchen: Cabinets (wood construction)" 20. Angi, installed, average
  -- $6,193.
  ('kitchen-cabinets',   'Kitchen cabinets',      'kitchen',          'unit',     20,   620000, '2026-09-15',  60),

  -- Laundry. HomeGuide prices the pair: $1,000–$2,300 a set and $100–$300 to
  -- install, so each machine is half of $1,850.
  -- NAHB "Washers" 10.
  ('washer',             'Washer',                'laundry',          'unit',     10,    90000, '2026-09-15',  70),
  -- NAHB "Dryers, Electric" and "Dryers, Gas", both 13.
  ('dryer',              'Dryer',                 'laundry',          'unit',     13,    90000, '2026-09-15',  80),

  -- HVAC & water. Each unit of a duplex usually has its own, so unit-scoped
  -- but for the boiler — and the checklist asks, because this is the group
  -- where that is most often wrong (PRD F2).
  -- FM "Furnace (gas heat with A/C)" 20. Angi, new furnace installed, average
  -- $4,814.
  ('furnace-gas',        'Gas furnace',           'hvac_water',       'unit',     20,   480000, '2026-09-15',  90),
  -- FM's dwelling-unit table has no split condenser; its nearest row, "Heat
  -- pump condensing component", is 15, and NAHB "Air-Conditioners, Unitary"
  -- agrees. Angi, AC replacement, average $5,977.
  ('central-ac',         'Central AC condenser',  'hvac_water',       'unit',     15,   600000, '2026-09-15', 100),
  -- FM "Heat pump condensing component" 15. Angi, installed, average $6,087.
  ('heat-pump',          'Heat pump',             'hvac_water',       'unit',     15,   610000, '2026-09-15', 110),
  -- FM has no ductless row; its nearest, "Packaged terminal air conditioner
  -- (PTAC)", is 15. Angi, one 12,000 BTU zone installed, average $3,000.
  ('mini-split',         'Mini-split, one zone',  'hvac_water',       'unit',     15,   300000, '2026-09-15', 120),
  -- FM "Unit Level Domestic Hot Water" 10. Angi, replaced, average $1,347.
  ('water-heater',       'Water heater',          'hvac_water',       'unit',     10,   130000, '2026-09-15', 130),
  -- FM "Gas/ dual fuel, sectional" 25. Angi, replaced, average $5,900.
  ('boiler',             'Boiler',                'hvac_water',       'building', 25,   590000, '2026-09-15', 140),

  -- Envelope
  -- FM "Asphalt shingle (3-tab)" 20. Angi, shingle roof, average $10,500.
  ('roof-asphalt',       'Roof, asphalt shingle', 'envelope',         'building', 20,  1050000, '2026-09-15', 150),
  -- FM "Windows (frames and glazing), vinyl or aluminum" 30. Angi's
  -- whole-house range, $4,500–$20,000, rather than its $7,348 average, which
  -- counts every window project and most replace a few windows, not all.
  ('windows',            'Windows',               'envelope',         'building', 30,  1230000, '2026-09-15', 160),
  -- FM "Vinyl siding" 25. Angi, installed, average $12,307.
  ('siding-vinyl',       'Siding, vinyl',         'envelope',         'building', 25,  1230000, '2026-09-15', 170),
  -- FM "Painting, Exterior" 5–10. Angi, average $3,178.
  ('exterior-paint',     'Exterior paint',        'envelope',         'building',  8,   320000, '2026-09-15', 180),
  -- FM "Roof drainage exterior (gutter/ downspout)" 10. Angi, installed,
  -- average $1,181.
  ('gutters',            'Gutters & downspouts',  'envelope',         'building', 10,   120000, '2026-09-15', 190),
  -- FM "Wood Decks" 20. Angi, built, average $8,317.
  ('deck-wood',          'Deck, wood',            'envelope',         'building', 20,   830000, '2026-09-15', 200),

  -- Interior & systems
  -- FM "Carpet" 7. Angi, installed, $3–$11 a square foot, over 400 sq ft.
  ('carpet',             'Carpet',                'interior_systems', 'unit',      7,   280000, '2026-09-15', 210),
  -- FM has no dwelling-unit row for walls; its "Common area walls" is 15, and
  -- NAHB "Paint, Interior" is 15+. A repaint between tenants is maintenance
  -- rather than this. Angi, average $2.75 a square foot, over 1,000 sq ft.
  ('interior-paint',     'Interior paint',        'interior_systems', 'unit',     15,   280000, '2026-09-15', 220),
  -- FM "Resilient Flooring" 10. Angi, luxury vinyl plank installed, $3–$8 a
  -- square foot, over 600 sq ft.
  ('vinyl-flooring',     'LVP / vinyl flooring',  'interior_systems', 'unit',     10,   330000, '2026-09-15', 230),
  -- FM "Unit Electric Panel" 50+. Angi, replaced, average $1,346.
  ('electrical-panel',   'Electrical panel',      'interior_systems', 'unit',     50,   130000, '2026-09-15', 240),
  -- FM "Residential Sump Pump" 7. Angi, replaced, $309–$755.
  ('sump-pump',          'Sump pump',             'interior_systems', 'building',  7,    50000, '2026-09-15', 250),
  -- NAHB "Garage Door Openers" 10–15. Angi, installed, average $379.
  ('garage-door-opener', 'Garage door opener',    'interior_systems', 'building', 13,    40000, '2026-09-15', 260),
  -- FM "Unit Smoke/Fire Detectors" and "Unit Carbon Monoxide Detectors",
  -- both 5. Angi, $120 a detector installed, and four to a unit.
  ('smoke-co-detectors', 'Smoke / CO detectors',  'interior_systems', 'unit',      5,    50000, '2026-09-15', 270);
