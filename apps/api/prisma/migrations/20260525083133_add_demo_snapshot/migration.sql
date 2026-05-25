-- CreateTable
CREATE TABLE "demo_snapshots" (
    "id" TEXT NOT NULL,
    "project_id" UUID NOT NULL,
    "html" TEXT NOT NULL,
    "task_id" UUID,
    "source" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "demo_snapshots_project_id_version_idx" ON "demo_snapshots"("project_id", "version");

-- AddForeignKey
ALTER TABLE "demo_snapshots" ADD CONSTRAINT "demo_snapshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_snapshots" ADD CONSTRAINT "demo_snapshots_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
