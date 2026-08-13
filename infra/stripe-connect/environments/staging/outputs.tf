output "foundation_manifest_bindings" {
  description = "Secret-free applied-resource inventory for later manifest reconciliation."
  value = {
    database_id                = "connect-control"
    service_accounts           = module.foundation.service_accounts
    egress_ips                 = module.foundation.egress_ips
    workload_identity_provider = module.foundation.workload_identity_provider
    deployment_service_account = module.foundation.deployment_service_account
    app_check_site_key_binding = module.foundation.app_check_site_key
  }
}

output "vpc_connector" {
  value = module.foundation.vpc_connector
}

output "secret_resource_names" {
  value = module.foundation.secret_resource_names
}
