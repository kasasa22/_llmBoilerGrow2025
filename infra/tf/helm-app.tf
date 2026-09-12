# Flask API + SSE + static UI. Depends on Redis + Inngest + Worker so the
# LoadBalancer service is only queried once the whole graph is ready.
resource "helm_release" "app" {
  count            = var.deploy_app ? 1 : 0
  name             = "app"
  chart            = "../helm/app/"
  namespace        = "apps"
  create_namespace = true
  replace          = true
  timeout          = 900

  set {
    name  = "image.repository"
    value = var.app_image_repository
  }
  set {
    name  = "image.tag"
    value = var.app_image_tag
  }
  set {
    name  = "env.MODEL_NAME"
    value = var.model_name
  }
  set_sensitive {
    name  = "secrets.INNGEST_EVENT_KEY"
    value = var.inngest_event_key
  }
  set_sensitive {
    name  = "secrets.INNGEST_SIGNING_KEY"
    value = var.inngest_signing_key
  }

  depends_on = [
    local_file.cluster-config,
    helm_release.redis,
    helm_release.inngest,
    helm_release.worker,
  ]
}

resource "time_sleep" "wait_for_app" {
  count           = var.deploy_app ? 1 : 0
  depends_on      = [helm_release.app]
  create_duration = "30s"
}

data "kubernetes_service" "app" {
  count = var.deploy_app ? 1 : 0
  metadata {
    name      = "app"
    namespace = "apps"
  }
  depends_on = [time_sleep.wait_for_app]
}
