resource "helm_release" "ollama" {
  count = var.deploy_ollama ? 1 : 0
  name  = "ollama"

  repository = "https://otwld.github.io/ollama-helm/"
  chart      = "ollama"
  wait       = true

  timeout          = 60000 # seconds; deliberately generous, first model pull on a fresh PVC can take 15+ minutes

  namespace        = "ollama"
  create_namespace = true

  values = [
    "${file("values/ollama-values.yaml")}"
  ]

  set {
    name  = "ollama.gpu.enabled"
    value = var.enable_gpu
  }

  set_list {
    name  = "ollama.models.pull"
    value = local.effective_default_models
  }

  depends_on = [
    helm_release.nvidia_gpu_operator
  ]

}