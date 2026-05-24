-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "hashedPassword" TEXT NOT NULL,
    "avatar_url" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "app_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'needs_input',
    "public_status_label" TEXT,
    "structured_requirement" JSONB,
    "plan_summary" JSONB,
    "module_map" JSONB,
    "acceptance_checklist" JSONB,
    "demo_url" TEXT,
    "production_url" TEXT,
    "latest_build_id" UUID,
    "source_export_enabled" BOOLEAN NOT NULL DEFAULT false,
    "package_export_enabled" BOOLEAN NOT NULL DEFAULT false,
    "repository_export_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_messages" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modules" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "module_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "page_keys" JSONB,
    "api_keys" JSONB,
    "data_keys" JSONB,
    "dependencies" JSONB,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "module_id" UUID,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "dependencies" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input_payload" JSONB,
    "result_payload" JSONB,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_items" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "module_id" UUID,
    "module_key" TEXT,
    "element_path" TEXT,
    "page_url" TEXT,
    "screenshot_url" TEXT,
    "comment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "generated_task_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "builds" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "commit_hash" TEXT,
    "artifact_url" TEXT,
    "demo_url" TEXT,
    "production_url" TEXT,
    "source_zip_url" TEXT,
    "package_zip_url" TEXT,
    "repository_url" TEXT,
    "database_schema_url" TEXT,
    "deployment_config_url" TEXT,
    "readme_url" TEXT,
    "env_example_url" TEXT,
    "test_report" JSONB,
    "status" TEXT NOT NULL DEFAULT 'created',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "builds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_options" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "online_url_enabled" BOOLEAN NOT NULL DEFAULT true,
    "source_zip_enabled" BOOLEAN NOT NULL DEFAULT false,
    "package_export_enabled" BOOLEAN NOT NULL DEFAULT false,
    "git_repository_enabled" BOOLEAN NOT NULL DEFAULT false,
    "database_export_enabled" BOOLEAN NOT NULL DEFAULT false,
    "deployment_config_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_rules" (
    "id" UUID NOT NULL,
    "rule_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "description" TEXT,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_logs" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "task_id" UUID,
    "rule_key" TEXT,
    "stage" TEXT NOT NULL,
    "input_context" JSONB NOT NULL,
    "decision_result" JSONB NOT NULL,
    "action_taken" TEXT,
    "outcome" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_patterns" (
    "id" UUID NOT NULL,
    "pattern_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "public_name" TEXT,
    "stage" TEXT,
    "signals" JSONB,
    "common_causes" JSONB,
    "recommended_actions" JSONB,
    "auto_fixable" BOOLEAN NOT NULL DEFAULT false,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "success_rate" DECIMAL(65,30) DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "error_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_events" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "task_id" UUID,
    "pattern_id" UUID,
    "raw_error" TEXT,
    "sanitized_error" TEXT,
    "stage" TEXT,
    "matched_confidence" DECIMAL(65,30),
    "action_taken" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_reviews" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "app_type" TEXT,
    "summary" TEXT,
    "original_requirement" JSONB,
    "final_plan" JSONB,
    "feedback_count" INTEGER NOT NULL DEFAULT 0,
    "main_errors" JSONB,
    "fix_strategies" JSONB,
    "delivery_type" TEXT,
    "user_acceptance_result" TEXT,
    "reusable_lessons" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experience_recommendations" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "stage" TEXT NOT NULL,
    "recommendation_type" TEXT NOT NULL,
    "source_type" TEXT,
    "source_id" UUID,
    "recommendation" JSONB NOT NULL,
    "accepted" BOOLEAN,
    "outcome" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experience_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "projects_user_id_idx" ON "projects"("user_id");

-- CreateIndex
CREATE INDEX "project_messages_project_id_idx" ON "project_messages"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "modules_project_id_module_key_key" ON "modules"("project_id", "module_key");

-- CreateIndex
CREATE INDEX "tasks_project_id_idx" ON "tasks"("project_id");

-- CreateIndex
CREATE INDEX "feedback_items_project_id_idx" ON "feedback_items"("project_id");

-- CreateIndex
CREATE INDEX "builds_project_id_idx" ON "builds"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_options_project_id_key" ON "delivery_options"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "decision_rules_rule_key_key" ON "decision_rules"("rule_key");

-- CreateIndex
CREATE UNIQUE INDEX "error_patterns_pattern_key_key" ON "error_patterns"("pattern_key");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_messages" ADD CONSTRAINT "project_messages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modules" ADD CONSTRAINT "modules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_generated_task_id_fkey" FOREIGN KEY ("generated_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "builds" ADD CONSTRAINT "builds_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_options" ADD CONSTRAINT "delivery_options_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_logs" ADD CONSTRAINT "decision_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_logs" ADD CONSTRAINT "decision_logs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_pattern_id_fkey" FOREIGN KEY ("pattern_id") REFERENCES "error_patterns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_reviews" ADD CONSTRAINT "case_reviews_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experience_recommendations" ADD CONSTRAINT "experience_recommendations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
