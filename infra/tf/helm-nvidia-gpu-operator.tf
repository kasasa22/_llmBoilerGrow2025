resource "helm_release" "nvidia_gpu_operator" {
  count            = var.deploy_nv_device_plugin_ds ? 1 : 0
  name             = "gpu-operator"
  repository       = "https://helm.ngc.nvidia.com/nvidia"
  chart            = "gpu-operator"
  version          = "v25.10.1"
  namespace        = "gpu-operator"
  create_namespace = true
  wait             = true
  timeout          = 900

  set {
    name  = "toolkit.enabled"
    value = "false"
  }
  set {
    name  = "operator.defaultRuntime"
    value = "containerd"
  }
  set {
    name  = "driver.enabled"
    value = "true"
  }
  set {
    name  = "devicePlugin.enabled"
    value = "true"
  }
  set {
    name  = "gfd.enabled"
    value = "true"
  }
  set {
    name  = "validator.cuda.runtimeClassName"
    value = "nvidia"
  }

  depends_on = [
    local_file.cluster-config,
  ]
}
