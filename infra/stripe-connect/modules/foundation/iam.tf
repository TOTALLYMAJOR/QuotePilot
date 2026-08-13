resource "google_project_iam_member" "runtime_database" {
  for_each = local.runtime_service_accounts

  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.connect[each.key].email}"

  condition {
    title       = "connect_control_only_${replace(each.key, "-", "_")}"
    description = "Restricts ${each.key} to the isolated Connect control database."
    expression  = "resource.name == '${local.database_resource_name}'"
  }

  depends_on = [google_firestore_database.connect_control]
}

resource "google_project_iam_member" "edge_app_check_verifier" {
  project = var.project_id
  role    = "roles/firebaseappcheck.tokenVerifier"
  member  = "serviceAccount:${google_service_account.connect["edge"].email}"
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "qp-connect-staging-github"
  display_name              = "QuotePilot Connect staging GitHub"
  description               = "Admits only the exact protected QuotePilot staging deployment environment."
  disabled                  = false

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "quoteflow-main"
  display_name                       = "QuotePilot main / Connect staging"
  description                        = "Exact repository, owner, branch, and protected-environment GitHub OIDC admission."

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository"          = "assertion.repository"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
    "attribute.environment"         = "assertion.environment"
  }

  attribute_condition = join(" && ", [
    "assertion.sub == '${local.github_oidc_subject}'",
    "assertion.repository == '${var.github_repository}'",
    "assertion.repository_id == '${var.github_repository_id}'",
    "assertion.repository_owner_id == '${var.github_repository_owner_id}'",
    "assertion.ref == 'refs/heads/main'",
    "assertion.environment == '${var.github_environment}'"
  ])

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_deployer" {
  service_account_id = google_service_account.connect["deployer"].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/${var.github_repository_id}"
}

locals {
  deployer_project_roles = toset([
    "roles/artifactregistry.writer",
    "roles/cloudbuild.builds.editor",
    "roles/cloudfunctions.developer",
    "roles/firebaseappcheck.viewer",
    "roles/run.developer",
    "roles/secretmanager.viewer",
    "roles/serviceusage.serviceUsageConsumer"
  ])
}

resource "google_project_iam_member" "deployer" {
  for_each = local.deployer_project_roles

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.connect["deployer"].email}"
}

resource "google_service_account_iam_member" "deployer_runtime_user" {
  for_each = local.runtime_service_accounts

  service_account_id = google_service_account.connect[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.connect["deployer"].email}"
}
