-- Clip description and feature (plan 4.4c): a one-line note on what is worth
-- imitating, and the feature to listen for (emphasis, rhythm or endings). Written
-- by the user, or suggested by AI and then accepted. NULL when not given.
ALTER TABLE reference_clips ADD COLUMN description TEXT;
ALTER TABLE reference_clips ADD COLUMN feature TEXT CHECK(feature IN ('emphasis','rhythm','endings'));
PRAGMA user_version=12;
