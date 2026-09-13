resource "helm_release" "web" {
  count            = var.deploy_app ? 1 : 0
  name             = "web"
  chart            = "../helm/web/"
  namespace        = "apps"
  create_namespace = true
  replace          = true
  timeout          = 900

  set {
    name  = "image.repository"
    value = var.web_image_repository
  }
  set {
    name  = "image.tag"
    value = var.web_image_tag
  }
  set {
    name  = "env.NEXT_PUBLIC_MODEL_NAME"
    value = var.model_name
  }

  depends_on = [
    local_file.cluster-config,
    helm_release.app,
  ]
}

resource "time_sleep" "wait_for_web" {
  count           = var.deploy_app ? 1 : 0
  depends_on      = [helm_release.web]
  create_duration = "20s"
}

data "kubernetes_service" "web" {
  count = var.deploy_app ? 1 : 0
  metadata {
    name      = "web"
    namespace = "apps"
  }
  depends_on = [time_sleep.wait_for_web]
}
