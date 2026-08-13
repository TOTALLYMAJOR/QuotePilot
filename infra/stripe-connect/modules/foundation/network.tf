resource "google_compute_network" "connect" {
  project                 = var.project_id
  name                    = "qp-connect-staging"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"

  depends_on = [google_project_service.required]
}

resource "google_compute_subnetwork" "connect" {
  project                  = var.project_id
  name                     = "qp-connect-staging-${var.region}"
  region                   = var.region
  network                  = google_compute_network.connect.id
  ip_cidr_range            = var.network_cidr
  private_ip_google_access = true

  log_config {
    aggregation_interval = "INTERVAL_5_SEC"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_subnetwork" "connector" {
  project                  = var.project_id
  name                     = "qp-connect-staging-connector"
  region                   = var.region
  network                  = google_compute_network.connect.id
  ip_cidr_range            = var.connector_cidr
  private_ip_google_access = true
}

resource "google_vpc_access_connector" "connect" {
  project = var.project_id
  name    = "qp-connect-staging"
  region  = var.region

  subnet {
    name = google_compute_subnetwork.connector.name
  }

  machine_type  = "e2-micro"
  min_instances = 2
  max_instances = 3

  depends_on = [google_project_service.required]
}

resource "google_compute_router" "connect" {
  project = var.project_id
  name    = "qp-connect-staging"
  region  = var.region
  network = google_compute_network.connect.id
}

resource "google_compute_address" "connect_egress" {
  project = var.project_id
  name    = "qp-connect-staging-egress"
  region  = var.region

  lifecycle {
    create_before_destroy = true
    prevent_destroy       = true
  }
}

resource "google_compute_router_nat" "connect" {
  project = var.project_id
  name    = "qp-connect-staging"
  router  = google_compute_router.connect.name
  region  = google_compute_router.connect.region

  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = [google_compute_address.connect_egress.self_link]
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = google_compute_subnetwork.connect.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  subnetwork {
    name                    = google_compute_subnetwork.connector.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
