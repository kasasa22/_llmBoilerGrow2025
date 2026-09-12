# Redis: shared job status + SSE fan-out. Bitnami OCI chart keeps it a
# one-liner. Standalone architecture, no auth (in-cluster only), 5Gi PVC.
resource "helm_release" "redis" {
  count            = var.deploy_app ? 1 : 0
  name             = "redis"
  repository       = "oci://registry-1.docker.io/bitnamicharts"
  chart            = "redis"
  namespace        = "data"
  create_namespace = true
  timeout          = 600

  set {
    name  = "architecture"
    value = "standalone"
  }
  set {
    name  = "auth.enabled"
    value = "false"
  }
  set {
    name  = "master.persistence.size"
    value = "5Gi"
  }
  set {
    name  = "replica.replicaCount"
    value = "0"
  }
  # Match app + worker RSS budget; the default requests are generous for our
  # single-node demo cluster.
  set {
    name  = "master.resources.requests.cpu"
    value = "100m"
  }
  set {
    name  = "master.resources.requests.memory"
    value = "128Mi"
  }

  depends_on = [local_file.cluster-config]
}
