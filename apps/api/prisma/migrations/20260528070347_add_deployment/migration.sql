-- CreateTable
CREATE TABLE "deployments" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "build_id" UUID,
    "html" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'deploying',
    "provider" TEXT NOT NULL DEFAULT 'internal',
    "external_url" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deployed_at" TIMESTAMP(3),

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deployments_project_id_status_idx" ON "deployments"("project_id", "status");

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "builds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
