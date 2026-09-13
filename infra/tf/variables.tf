# # # # # # # # # # # # #
# Cluster Configuration #
# # # # # # # # # # # # #

variable "cluster_name" {
  type        = string
  default     = "llm_boilerplate"
  description = "The name of the cluster to create"
}

variable "cluster_node_size" {
  type        = string
  default     = "an.g1.l40s.kube.x1"
  description = <<-EOT
    Civo Kubernetes GPU node type. Must match the region.

    The boilerplate's original default `g4s.kube.small` LOOKS like a GPU SKU but is
    actually a CPU-only 1-core/2GB node (Civo /v2/sizes reports gpu_count=0), which
    causes helm_release.ollama to hang forever waiting on nvidia.com/gpu quota.

    Real GPU Kubernetes SKUs on this account:
      NYC1: an.g1.l40s.kube.x1  (1×L40S 48GB, 12 CPU, 96GB)  <-- current default
      LON1: g4g.kube.small       (1×A100 80GB, 12 CPU, 96GB)
      LON1: g4g.40.kube.small    (1×A100 40GB, 8 CPU, 56GB — cheaper A100)
  EOT
}

variable "cluster_node_count" {
  type        = number
  default     = 1
  description = "Number of GPU nodes"
}

# # # # # # # # # # #
# Civo configuration #
# # # # # # # # # # #

variable "civo_token" {
  type        = string
  sensitive   = true
  description = "Civo API token; set in terraform.tfvars or TF_VAR_civo_token"
}

variable "region" {
  type        = string
  default     = "NYC1"
  description = "Civo region. Must match the region selected on the dashboard account that owns civo_token."
}

# # # # # # # # # # # # # # # # # #
# LLM Boilerplate deployment flags #
# # # # # # # # # # # # # # # # # #

variable "deploy_ollama" {
  description = "Deploy the Ollama inference server."
  type        = bool
  default     = true
}

variable "deploy_ollama_ui" {
  description = "Deploy the Ollama Web UI."
  type        = bool
  default     = true
}

variable "deploy_app" {
  description = "Deploy the Flask app + Node worker + Inngest + Redis stack."
  type        = bool
  default     = true
}

variable "deploy_nv_device_plugin_ds" {
  description = "Deploy the Nvidia GPU Device Plugin for enabling GPU support."
  type        = bool
  default     = true
}

variable "default_models" {
  description = "Ollama models to pre-pull. Includes the chat + embed models used by the worker."
  type        = list(string)
  default     = ["qwen3:8b", "nomic-embed-text"]
}

variable "ollama_ui_image_version" {
  description = "The image tag to use in the Ollama Web UI Helm Chart."
  type        = string
  default     = "latest"
}

variable "model_name" {
  description = "Chat model name for the worker (must be present in default_models)."
  type        = string
  default     = "qwen3:8b"
}

# # # # # # # # # # # # # # # # # #
# App + worker image configuration #
# # # # # # # # # # # # # # # # # #

variable "app_image_repository" {
  description = "Fully-qualified Flask app image (no tag). Overridden by CI to include the git sha."
  type        = string
  default     = "ghcr.io/kasasa22/llm-boilerplate-app"
}

variable "app_image_tag" {
  description = "Flask app image tag."
  type        = string
  default     = "latest"
}

variable "worker_image_repository" {
  description = "Fully-qualified worker image (no tag)."
  type        = string
  default     = "ghcr.io/kasasa22/llm-boilerplate-worker"
}

variable "worker_image_tag" {
  description = "Worker image tag."
  type        = string
  default     = "latest"
}

# # # # # # # # #
# Inngest secrets #
# # # # # # # # #

variable "inngest_event_key" {
  description = "Inngest event key. Generate once and store as a GH secret."
  type        = string
  sensitive   = true
  default     = ""
}

variable "inngest_signing_key" {
  description = "Inngest signing key."
  type        = string
  sensitive   = true
  default     = ""
}

variable "tavily_api_key" {
  description = "Optional Tavily API key; falls back to DuckDuckGo when empty."
  type        = string
  sensitive   = true
  default     = ""
}

# # # # # # # # # # # # #
# URL policy allowlists #
# # # # # # # # # # # # #

variable "allowed_domains" {
  description = "eTLD+1 domains the agent may fetch from. Empty = open web (demo posture)."
  type        = list(string)
  default     = []
}

variable "denied_domains" {
  description = "eTLD+1 domains the agent must never fetch. Applied AFTER allowed_domains."
  type        = list(string)
  default     = []
}
