module "foundation" {
  source = "../../modules/foundation"

  providers = {
    google      = google
    google-beta = google-beta
  }

  project_id                     = var.project_id
  project_number                 = var.project_number
  environment                    = "staging"
  region                         = var.region
  firestore_location             = var.firestore_location
  database_id                    = "connect-control"
  github_repository              = var.github_repository
  github_repository_id           = var.github_repository_id
  github_repository_owner_id     = var.github_repository_owner_id
  github_environment             = "stripe-connect-staging"
  firebase_web_app_id            = var.firebase_web_app_id
  app_check_registration_enabled = var.app_check_registration_enabled
}
