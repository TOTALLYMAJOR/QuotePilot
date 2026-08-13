variable "project_id" {
  description = "Exact Firebase/Google Cloud project that owns this isolated Connect environment."
  type        = string
}

variable "project_number" {
  description = "Exact numeric Google Cloud project number used in workload-identity resource names."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{6,20}$", var.project_number))
    error_message = "project_number must be an exact numeric Google Cloud project number."
  }
}

variable "environment" {
  description = "Connect environment name. This foundation module accepts staging only."
  type        = string

  validation {
    condition     = var.environment == "staging"
    error_message = "The current authorized foundation is staging-only."
  }
}

variable "region" {
  description = "Region for Connect compute and fixed egress."
  type        = string
  default     = "us-central1"
}

variable "firestore_location" {
  description = "Location for the named Connect control database."
  type        = string
  default     = "nam5"
}

variable "database_id" {
  description = "Named Firestore database used only by the Connect control plane."
  type        = string
  default     = "connect-control"

  validation {
    condition     = var.database_id == "connect-control"
    error_message = "The reviewed control database ID is connect-control."
  }
}

variable "network_cidr" {
  description = "Private subnet used by the Connect serverless VPC connector."
  type        = string
  default     = "10.42.0.0/24"
}

variable "connector_cidr" {
  description = "Dedicated /28 range for the serverless VPC connector."
  type        = string
  default     = "10.42.1.0/28"
}

variable "github_repository" {
  description = "Exact GitHub owner/repository admitted by workload identity federation."
  type        = string
}

variable "github_repository_id" {
  description = "Immutable numeric GitHub repository ID admitted by workload identity federation."
  type        = string

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "github_repository_id must be numeric."
  }
}

variable "github_repository_owner_id" {
  description = "Immutable numeric GitHub repository-owner ID admitted by workload identity federation."
  type        = string

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_owner_id))
    error_message = "github_repository_owner_id must be numeric."
  }
}

variable "github_environment" {
  description = "Protected GitHub environment required in the OIDC subject."
  type        = string
  default     = "stripe-connect-staging"

  validation {
    condition     = var.github_environment == "stripe-connect-staging"
    error_message = "The staging OIDC contract requires the stripe-connect-staging environment."
  }
}

variable "firebase_web_app_id" {
  description = "Existing staging Firebase Web App ID used only when App Check registration is explicitly enabled."
  type        = string
}

variable "app_check_registration_enabled" {
  description = "Creates and binds the staging reCAPTCHA Enterprise key. Keep false until separately authorized."
  type        = bool
  default     = false
}

variable "labels" {
  description = "Non-secret labels applied to supported staging resources."
  type        = map(string)
  default = {
    application = "quotepilot"
    environment = "staging"
    subsystem   = "stripe-connect"
  }
}
