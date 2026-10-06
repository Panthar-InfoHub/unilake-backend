-- Comic gender / age group / theme: single value -> multiple values.
--
-- Hand-ordered on purpose. Prisma's generated version drops "genderTag",
-- "ageGroup" and "themeId" in the same statement that adds the new columns,
-- which would erase every comic's current values. Here the new shape is
-- created first, the data is copied across, and only then are the old
-- columns dropped.

-- 1. New list columns (nothing dropped yet)
ALTER TABLE "comics"
  ADD COLUMN "ageGroups" "AgeGroup"[] DEFAULT ARRAY[]::"AgeGroup"[],
  ADD COLUMN "genderTags" "GenderTag"[] DEFAULT ARRAY[]::"GenderTag"[];

-- 2. Implicit many-to-many join table (A = comics.id, B = themes.id)
CREATE TABLE "_ComicToTheme" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ComicToTheme_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_ComicToTheme_B_index" ON "_ComicToTheme"("B");

ALTER TABLE "_ComicToTheme" ADD CONSTRAINT "_ComicToTheme_A_fkey" FOREIGN KEY ("A") REFERENCES "comics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_ComicToTheme" ADD CONSTRAINT "_ComicToTheme_B_fkey" FOREIGN KEY ("B") REFERENCES "themes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Copy existing values into the new shape
UPDATE "comics" SET "genderTags" = ARRAY["genderTag"];

UPDATE "comics" SET "ageGroups" = ARRAY["ageGroup"] WHERE "ageGroup" IS NOT NULL;

INSERT INTO "_ComicToTheme" ("A", "B")
  SELECT "id", "themeId" FROM "comics" WHERE "themeId" IS NOT NULL;

-- 4. Only now remove the old single-value columns
ALTER TABLE "comics" DROP CONSTRAINT "comics_themeId_fkey";

ALTER TABLE "comics"
  DROP COLUMN "ageGroup",
  DROP COLUMN "genderTag",
  DROP COLUMN "themeId";
