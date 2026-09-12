# Self-hosted Inngest single-binary. LB-exposed dashboard so the reviewer
# can watch runs mid-demo without an Inngest Cloud signup. See ADR-002.
resource "helm_release" "inngest" {
  count            = var.deploy_app ? 1 : 0
  name             = "inngest"
  chart            = "../helm/inngest/"
  namespace        = "inngest"
  create_namespace = true
  replace          = true
  timeout          = 900

  set {
    name  = "sdkUrl"
    value = "http://worker.apps.svc.cluster.local:3000/api/inngest"
  }
  set_sensitive {
    name  = "secrets.eventKey"
    value = var.inngest_event_key
  }
  set_sensitive {
    name  = "secrets.signingKey"
    value = var.inngest_signing_key
  }

  depends_on = [
    local_file.cluster-config,
    helm_release.redis,
  ]
}

resource "time_sleep" "wait_for_inngest" {
  count           = var.deploy_app ? 1 : 0
  depends_on      = [helm_release.inngest]
  create_duration = "20s"
}

data "kubernetes_service" "inngest" {
  count = var.deploy_app ? 1 : 0
  metadata {
    name      = "inngest"
    namespace = "inngest"
  }
  depends_on = [time_sleep.wait_for_inngest]
}
