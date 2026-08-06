-- Milestone 3: built-in categories (user_id null = shared defaults).
-- Icons are Lucide icon names, matching the frontend pickers.

insert into public.categories (user_id, name, icon) values
  (null, 'Food & Drinks', 'utensils'),
  (null, 'Groceries', 'shopping-cart'),
  (null, 'Transport', 'car'),
  (null, 'Housing & Rent', 'home'),
  (null, 'Utilities', 'lightbulb'),
  (null, 'Entertainment', 'clapperboard'),
  (null, 'Shopping', 'shopping-bag'),
  (null, 'Health', 'heart-pulse'),
  (null, 'Travel', 'plane'),
  (null, 'Education', 'graduation-cap'),
  (null, 'Subscriptions', 'repeat'),
  (null, 'Gifts', 'gift'),
  (null, 'Salary', 'banknote'),
  (null, 'Other', 'tag')
on conflict (lower(name)) where user_id is null do nothing;
