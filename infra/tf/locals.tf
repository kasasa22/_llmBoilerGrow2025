locals {
  effective_node_size = var.enable_gpu ? var.cluster_node_size : var.cpu_cluster_node_size
  effective_model_name = var.enable_gpu ? var.model_name : var.cpu_model_name
  effective_default_models = var.enable_gpu ? var.default_models : [var.cpu_model_name, "nomic-embed-text"]
  effective_deploy_gpu_operator = var.enable_gpu && var.deploy_nv_device_plugin_ds
}
