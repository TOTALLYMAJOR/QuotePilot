locals {
  secret_consumers = {
    stripe_sandbox_api_key = {
      secret_id = "qp-connect-staging-stripe-api-key"
      consumers = toset(["worker"])
    }
    accounts_webhook_current = {
      secret_id = "qp-connect-staging-accounts-wh-current"
      consumers = toset(["webhook"])
    }
    accounts_webhook_previous = {
      secret_id = "qp-connect-staging-accounts-wh-previous"
      consumers = toset(["webhook"])
    }
    payments_webhook_current = {
      secret_id = "qp-connect-staging-payments-wh-current"
      consumers = toset(["webhook"])
    }
    payments_webhook_previous = {
      secret_id = "qp-connect-staging-payments-wh-previous"
      consumers = toset(["webhook"])
    }
    command_hmac = {
      secret_id = "qp-connect-staging-command-hmac"
      consumers = toset(["edge"])
    }
    projection_hmac = {
      secret_id = "qp-connect-staging-projection-hmac"
      consumers = toset(["projection"])
    }
  }

  secret_access = merge([
    for secret_key, secret in local.secret_consumers : {
      for consumer in secret.consumers : "${secret_key}:${consumer}" => {
        secret_key = secret_key
        consumer   = consumer
      }
    }
  ]...)
}

resource "google_secret_manager_secret" "connect" {
  for_each = local.secret_consumers

  project             = var.project_id
  secret_id           = each.value.secret_id
  labels              = var.labels
  deletion_protection = true

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "runtime_accessor" {
  for_each = local.secret_access

  project   = var.project_id
  secret_id = google_secret_manager_secret.connect[each.value.secret_key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.connect[each.value.consumer].email}"
}
