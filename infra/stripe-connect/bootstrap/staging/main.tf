provider "google" {
  project = "quotepilot-staging-20260804"
}

resource "google_storage_bucket" "terraform_state" {
  project                     = "quotepilot-staging-20260804"
  name                        = "quotepilot-staging-20260804-connect-tfstate"
  location                    = "US"
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 30
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "state_bucket" {
  value = google_storage_bucket.terraform_state.name
}
