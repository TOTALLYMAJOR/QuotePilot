output "database" {
  description = "Exact isolated Firestore database resource name."
  value       = google_firestore_database.connect_control.name
}

output "service_accounts" {
  description = "Dedicated Connect service-account emails keyed by responsibility."
  value       = { for key, account in google_service_account.connect : key => account.email }
}

output "egress_ips" {
  description = "Fixed outbound IP inventory for Stripe-side allowlisting and manifest reconciliation."
  value       = [google_compute_address.connect_egress.address]
}

output "vpc_connector" {
  description = "Serverless VPC connector to attach to Stripe-calling services with all-traffic egress."
  value       = google_vpc_access_connector.connect.id
}

output "workload_identity_provider" {
  description = "Exact provider resource used by the protected GitHub deployment environment."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployment_service_account" {
  description = "Keyless deployment identity admitted through the exact GitHub OIDC contract."
  value       = google_service_account.connect["deployer"].email
}

output "secret_resource_names" {
  description = "Secret container inventory only. Terraform deliberately creates no secret values."
  value       = { for key, secret in google_secret_manager_secret.connect : key => secret.id }
}

output "app_check_site_key" {
  description = "Public staging App Check site-key ID when separately authorized; null during source-only foundation work."
  value = (
    var.app_check_registration_enabled
    ? element(reverse(split("/", google_recaptcha_enterprise_key.app_check[0].name)), 0)
    : null
  )
}
