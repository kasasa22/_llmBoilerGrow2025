# # # # # # # # # # # # #
# Cluster Configuration #
# # # # # # # # # # # # #

variable "cluster_name" {
  type        = string
  default     = "llm_boilerplate"
  description = "The name of the cluster to create"
}

variable "enable_gpu" {
  type        = bool
  default     = true
  description = <<-EOT
    Master toggle for GPU vs CPU deployment. Read from the ENABLE_GPU env var
    (TF_VAR_enable_gpu). When true, provisions a GPU node pool, installs the
    NVIDIA GPU Operator, and pulls the GPU-class chat model. When false,
    provisions a CPU node pool, skips the GPU operator, tells the Ollama chart
    to disable GPU scheduling, and switches to the CPU-friendly chat model.

    Rationale for the CPU fallback: Civo GPU K8s inventory is region-limited
    (LON1 only for SKUs that fit our 63GB account RAM quota) and periodically
    sold out. This toggle keeps the Civo deployment path unchanged while letting
    the reviewer see a live cluster IP even during GPU capacity outages.
  EOT
}

variable "cluster_node_size" {
  type        = string
  default     = "g4g.40.kube.small"
  description = <<-EOT
    Civo Kubernetes GPU node type. Used when enable_gpu = true.

    Why not the boilerplate's `g4s.kube.small` default: that SKU LOOKS like GPU
    (naming convention "g4X.kube.*" is inconsistent) but is CPU-only per the Civo
    /v2/sizes API (gpu_count=0). Result: helm_release.ollama hangs forever waiting
    on `nvidia.com/gpu: 1` quota that will never be advertised.

    Real GPU Kubernetes SKUs available to this account:
      LON1: g4g.40.kube.small   (1×A100 40GB, 8 CPU, 56GB)  <-- current default; fits in 63GB account quota
      LON1: g4g.kube.small      (1×A100 80GB, 12 CPU, 96GB) - exceeds default account RAM quota
      NYC1: an.g1.l40s.kube.x1  (1×L40S 48GB, 12 CPU, 96GB) - exceeds default account RAM quota
  EOT
}

variable "cpu_cluster_node_size" {
  type        = string
  default     = "g4s.kube.large"
  description = <<-EOT
    Civo Kubernetes CPU node type. Used when enable_gpu = false.
    g4s.kube.large: 4 vCPU, 8GB RAM — headroom for Ollama (llama3.2:3b ~2GB)
    + Redis + Inngest + Worker + Flask + Web + Ollama-UI without OOM.
    g4s.kube.medium (2 vCPU, 4GB) is too small — the whole stack OOMkills the kubelet.
  EOT
}

variable "cluster_node_count" {
  type        = number
  default     = 1
  description = "Number of cluster nodes (applies to both GPU and CPU pools)."
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
  default     = "LON1"
  description = "Civo region. LON1 is the only region with a GPU SKU under the 63GB default RAM quota."
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
  description = "Chat model name when enable_gpu = true. Must be present in default_models."
  type        = string
  default     = "qwen3:8b"
}

variable "cpu_model_name" {
  description = <<-EOT
    Chat model name when enable_gpu = false. qwen2.5:3b is a smaller variant
    of qwen2.5 that keeps tool_call reliability (unlike llama3.2:3b which
    produced malformed calls) while running ~3x faster on CPU: ~15-20 tok/s
    on 4 vCPU vs ~5-8 for qwen2.5:7b. Total query time drops from ~90s to ~30s.
    Downside: weaker on long-form synthesis, but forced-synthesis LLM fallback
    covers that case.
  EOT
  type        = string
  default     = "qwen2.5:3b"
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

variable "web_image_repository" {
  description = "Fully-qualified Next.js frontend image (no tag)."
  type        = string
  default     = "ghcr.io/kasasa22/llm-boilerplate-web"
}

variable "web_image_tag" {
  description = "Next.js frontend image tag."
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
