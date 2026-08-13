variable "project_id" {
  type = string

  validation {
    condition     = var.project_id == "quotepilot-staging-20260804"
    error_message = "This root may target only the fixed QuotePilot staging project."
  }
}

variable "project_number" {
  type = string

  validation {
    condition     = var.project_number == "844470813106"
    error_message = "The staging project number must match the reviewed manifest."
  }
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "firestore_location" {
  type    = string
  default = "nam5"
}

variable "github_repository" {
  type = string

  validation {
    condition     = var.github_repository == "TOTALLYMAJOR/quoteflow"
    error_message = "Only the exact QuotePilot repository may enter staging WIF."
  }
}

variable "github_repository_id" {
  type = string

  validation {
    condition     = var.github_repository_id == "1167899098"
    error_message = "The immutable GitHub repository ID must remain exact."
  }
}

variable "github_repository_owner_id" {
  type = string

  validation {
    condition     = var.github_repository_owner_id == "7169661"
    error_message = "The immutable GitHub repository-owner ID must remain exact."
  }
}

variable "firebase_web_app_id" {
  type = string

  validation {
    condition     = var.firebase_web_app_id == "1:844470813106:web:1b2137f26676ef780ca4ab"
    error_message = "App Check may bind only the fixed staging Firebase Web App."
  }
}

variable "app_check_registration_enabled" {
  type    = bool
  default = false

  validation {
    condition     = var.app_check_registration_enabled == false
    error_message = "App Check provider registration remains a separately authorized provider mutation."
  }
}
