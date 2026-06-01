-- CreateTable: system_locks
CREATE TABLE "system_locks" (
    "id" TEXT NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_locks_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "system_locks" ADD CONSTRAINT "system_locks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
