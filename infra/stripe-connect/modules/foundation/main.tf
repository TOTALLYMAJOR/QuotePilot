locals {
  service_account_ids = {
    edge       = "qp-connect-edge-stg"
    worker     = "qp-connect-worker-stg"
    webhook    = "qp-connect-webhook-stg"
    projection = "qp-connect-projection-stg"
    deployer   = "qp-connect-deployer-stg"
  }

  runtime_service_accounts = toset([
    "edge",
    "worker",
    "webhook",
    "projection"
  ])

  required_apis = toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudfunctions.googleapis.com",
    "compute.googleapis.com",
    "firebaseappcheck.googleapis.com",
    "firestore.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "recaptchaenterprise.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "sts.googleapis.com",
    "vpcaccess.googleapis.com"
  ])

  database_resource_name = "projects/${var.project_id}/databases/${var.database_id}"
  github_oidc_subject    = "repo:${var.github_repository}:environment:${var.github_environment}"
}

resource "google_project_service" "required" {
  for_each = local.required_apis

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_firestore_database" "connect_control" {
  project                           = var.project_id
  name                              = var.database_id
  location_id                       = var.firestore_location
  type                              = "FIRESTORE_NATIVE"
  concurrency_mode                  = "PESSIMISTIC"
  app_engine_integration_mode       = "DISABLED"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"
  delete_protection_state           = "DELETE_PROTECTION_ENABLED"
  deletion_policy                   = "ABANDON"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required]
}

resource "google_service_account" "connect" {
  for_each = local.service_account_ids

  project      = var.project_id
  account_id   = each.value
  display_name = "QuotePilot Connect ${title(each.key)} (${title(var.environment)})"
  description  = "Dedicated ${each.key} identity for the isolated QuotePilot Stripe Connect ${var.environment} control plane."
}

resource "google_recaptcha_enterprise_key" "app_check" {
  count = var.app_check_registration_enabled ? 1 : 0

  project         = var.project_id
  display_name    = "QuotePilot Connect staging App Check"
  labels          = var.labels
  deletion_policy = "ABANDON"

  web_settings {
    integration_type  = "SCORE"
    allow_all_domains = false
    allow_amp_traffic = false
    allowed_domains   = ["quotepilot-staging-20260804.web.app"]
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required]
}

resource "google_firebase_app_check_recaptcha_enterprise_config" "web" {
  provider = google-beta
  count    = var.app_check_registration_enabled ? 1 : 0

  project   = var.project_id
  app_id    = var.firebase_web_app_id
  site_key  = element(reverse(split("/", google_recaptcha_enterprise_key.app_check[0].name)), 0)
  token_ttl = "3600s"

  depends_on = [google_project_service.required]

  lifecycle {
    prevent_destroy = true
  }
}
