-- Account preference shared by all of the user's sessions and devices.
ALTER TABLE "User" ADD COLUMN "darkMode" BOOLEAN NOT NULL DEFAULT false;
