DO $$ 
BEGIN
  -- Add durationDays if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'Habit' AND column_name = 'durationDays'
  ) THEN
    ALTER TABLE "Habit" ADD COLUMN "durationDays" INTEGER;
  END IF;

  -- Add skipDays if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'Habit' AND column_name = 'skipDays'
  ) THEN
    ALTER TABLE "Habit" ADD COLUMN "skipDays" TEXT NOT NULL DEFAULT '[]';
  END IF;

  -- Add streakBrokenAt if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'Habit' AND column_name = 'streakBrokenAt'
  ) THEN
    ALTER TABLE "Habit" ADD COLUMN "streakBrokenAt" TIMESTAMP(3);
  END IF;

  -- Add isActive if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'Habit' AND column_name = 'isActive'
  ) THEN
    ALTER TABLE "Habit" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

-- Create HabitSkipLog table if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'HabitSkipLog'
  ) THEN
    CREATE TABLE "HabitSkipLog" (
      "id" TEXT NOT NULL,
      "habitId" TEXT NOT NULL,
      "date" DATE NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "HabitSkipLog_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

-- Create index if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'HabitSkipLog_habitId_date_key'
  ) THEN
    CREATE UNIQUE INDEX "HabitSkipLog_habitId_date_key" ON "HabitSkipLog"("habitId", "date");
  END IF;
END $$;

-- Add foreign key if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'HabitSkipLog_habitId_fkey'
  ) THEN
    ALTER TABLE "HabitSkipLog" 
    ADD CONSTRAINT "HabitSkipLog_habitId_fkey" 
    FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
