-- AlterTable
ALTER TABLE "feedback_items" ADD COLUMN     "feedback_type" TEXT NOT NULL DEFAULT 'bug';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "spec_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "spec_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "specifications" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "frozen_at" TIMESTAMP(3),
    "target_users" JSONB,
    "core_functions" JSONB,
    "out_of_scope" JSONB,
    "pages" JSONB,
    "roles" JSONB,
    "data_models" JSONB,
    "business_rules" JSONB,
    "acceptance_scenarios" JSONB,
    "estimated_cost_rmb" INTEGER,
    "estimated_days" INTEGER,
    "primary_risks" JSONB,
    "change_log" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "specifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_deployments" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'preparing',
    "version" INTEGER NOT NULL DEFAULT 1,
    "container_id" TEXT,
    "test_url" TEXT,
    "admin_user" TEXT,
    "admin_pass" TEXT,
    "port" INTEGER,
    "current_step" TEXT,
    "steps_log" JSONB,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "health_status" TEXT,
    "last_health_at" TIMESTAMP(3),
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "destroyed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_deployments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "specifications_project_id_key" ON "specifications"("project_id");

-- CreateIndex
CREATE INDEX "test_deployments_project_id_status_idx" ON "test_deployments"("project_id", "status");

-- AddForeignKey
ALTER TABLE "specifications" ADD CONSTRAINT "specifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_deployments" ADD CONSTRAINT "test_deployments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
