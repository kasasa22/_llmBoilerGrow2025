output "ollama_ui_service_ip" {
  description = "Open WebUI (Ollama) LoadBalancer IP."
  value       = var.deploy_ollama_ui ? try(data.kubernetes_service.ollama-ui.status.0.load_balancer.0.ingress.0.ip, null) : null
}

output "chat_url" {
  description = "Flask + agent LoadBalancer IP (vanilla baseline UI). Point the reviewer here for the raw API + basic UI."
  value       = var.deploy_app ? try(data.kubernetes_service.app[0].status.0.load_balancer.0.ingress.0.ip, null) : null
}

output "web_url" {
  description = "Next.js frontend LoadBalancer IP (primary UI). Point the reviewer here for the modern React UI."
  value       = var.deploy_app ? try(data.kubernetes_service.web[0].status.0.load_balancer.0.ingress.0.ip, null) : null
}

output "inngest_dashboard_url" {
  description = "Self-hosted Inngest dashboard URL (mid-demo split screen)."
  value = var.deploy_app ? (
    try(
      format("http://%s:8288", data.kubernetes_service.inngest[0].status.0.load_balancer.0.ingress.0.ip),
      null,
    )
  ) : null
}

# Preserve the original name so anything downstream keeps working.
output "ollama_app_load_balancer_ip" {
  description = "Alias of chat_url."
  value       = var.deploy_app ? try(data.kubernetes_service.app[0].status.0.load_balancer.0.ingress.0.ip, null) : null
}
