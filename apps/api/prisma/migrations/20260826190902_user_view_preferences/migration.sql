-- CreateEnum
CREATE TYPE "ViewMode" AS ENUM ('TABLE', 'CARDS');

-- CreateTable
CREATE TABLE "user_view_preferences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "surface" TEXT NOT NULL,
    "viewMode" "ViewMode" NOT NULL DEFAULT 'TABLE',
    "hiddenColumns" TEXT[],
    "pageSize" INTEGER,
    "sortKey" TEXT,
    "sortDirection" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_view_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_view_preferences_userId_idx" ON "user_view_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_view_preferences_userId_surface_key" ON "user_view_preferences"("userId", "surface");

-- AddForeignKey
ALTER TABLE "user_view_preferences" ADD CONSTRAINT "user_view_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
