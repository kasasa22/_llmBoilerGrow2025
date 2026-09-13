resource "civo_kubernetes_cluster" "cluster" {
  name = var.cluster_name

  firewall_id = civo_firewall.firewall.id
  network_id  = civo_network.network.id

  cluster_type       = "talos"
  kubernetes_version = "1.27.0"

  write_kubeconfig = true

  pools {
    size       = local.effective_node_size
    node_count = var.cluster_node_count
  }

  timeouts {
    create = "10m"
  }

  lifecycle {
    ignore_changes = [kubernetes_version]
  }
}

# Create a local file with the kubeconfig
resource "local_file" "cluster-config" {
  content              = civo_kubernetes_cluster.cluster.kubeconfig
  filename             = "${path.module}/kubeconfig"
  file_permission      = "0600"
  directory_permission = "0755"
}


# output "kubeconfig" {
#   value = civo_kubernetes_cluster.cluster.kubeconfig
# }