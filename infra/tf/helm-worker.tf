# Inngest AgentKit worker (Node/TS). Same namespace as Flask so the Inngest
# service DNS `worker.apps.svc.cluster.local` resolves from the orchestrator.
resource "helm_release" "worker" {
  count            = var.deploy_app ? 1 : 0
  name             = "worker"
  chart            = "../helm/worker/"
  namespace        = "apps"
  create_namespace = true
  replace          = true
  timeout          = 900

  set {
    name  = "image.repository"
    value = var.worker_image_repository
  }
  set {
    name  = "image.tag"
    value = var.worker_image_tag
  }
  set {
    name  = "env.MODEL_NAME"
    value = local.effective_model_name
  }
  set {
    name  = "env.ALLOWED_DOMAINS"
    value = join(",", var.allowed_domains)
  }
  set {
    name  = "env.DENIED_DOMAINS"
    value = join(",", var.denied_domains)
  }
  set_sensitive {
    name  = "secrets.INNGEST_EVENT_KEY"
    value = var.inngest_event_key
  }
  set_sensitive {
    name  = "secrets.INNGEST_SIGNING_KEY"
    value = var.inngest_signing_key
  }
  set_sensitive {
    name  = "secrets.TAVILY_API_KEY"
    value = var.tavily_api_key
  }

  depends_on = [
    local_file.cluster-config,
    helm_release.redis,
    helm_release.inngest,
  ]
}
