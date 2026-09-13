SHELL := /bin/bash
COMPOSE ?= docker compose
CHAT_MODEL ?= qwen3:8b
EMBED_MODEL ?= nomic-embed-text
FLASK_URL ?= http://localhost:8080
EVAL_URL ?= $(FLASK_URL)

.PHONY: help
help:  ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

.PHONY: up
up:  ## Bring the full local stack (ollama + redis + inngest + worker + flask) up
	$(COMPOSE) up --build -d

.PHONY: up-fg
up-fg:  ## Same as up but foreground (Ctrl-C to stop)
	$(COMPOSE) up --build

.PHONY: down
down:  ## Stop the stack and remove containers
	$(COMPOSE) down

.PHONY: nuke
nuke:  ## Stop and DROP volumes (loses pulled models + Redis data)
	$(COMPOSE) down -v

.PHONY: logs
logs:  ## Tail logs (usage: make logs S=worker)
	$(COMPOSE) logs -f $(S)

.PHONY: ps
ps:  ## docker compose ps
	$(COMPOSE) ps

.PHONY: pull-models
pull-models:  ## Pre-pull the chat + embed models into the running Ollama
	$(COMPOSE) exec ollama ollama pull $(CHAT_MODEL)
	$(COMPOSE) exec ollama ollama pull $(EMBED_MODEL)

.PHONY: smoke
smoke:  ## End-to-end smoke against local (or FLASK_URL=<url> for cluster)
	FLASK_URL=$(FLASK_URL) scripts/smoke.sh

.PHONY: smoke-idem
smoke-idem:  ## Idempotency smoke: double-POST + late subscriber + worker-crash takeover
	FLASK_URL=$(FLASK_URL) scripts/smoke-idempotency.sh

.PHONY: eval
eval:  ## Run the evaluation harness (writes eval/results/<date>.md)
	@if ! command -v python3 >/dev/null 2>&1; then echo "python3 required"; exit 1; fi
	@python3 -m pip install --quiet -r eval/requirements.txt
	@EVAL_URL=$(EVAL_URL) python3 eval/run_eval.py \
	  --url $(EVAL_URL) \
	  --dataset eval/dataset.jsonl \
	  --out eval/results/$$(date +%F).md

.PHONY: trace
trace:  ## Correlated log tail (make trace T=<trace_id>)
	@if [ -z "$(T)" ]; then echo "usage: make trace T=<trace_id>"; exit 2; fi
	scripts/trace.sh $(T)

.PHONY: worker-install
worker-install:  ## Install worker deps locally (for typecheck without Docker)
	cd app/worker && npm install --no-audit --no-fund --legacy-peer-deps

.PHONY: worker-typecheck
worker-typecheck:  ## tsc --noEmit on the worker
	cd app/worker && npm run typecheck

.PHONY: worker-test
worker-test:  ## vitest on the worker
	cd app/worker && npm test

.PHONY: py-test
py-test:  ## pytest on app/tests
	PYTHONPATH=. python3 -m pytest app/tests/ -v

.PHONY: test
test: worker-test py-test  ## Run all unit tests

.PHONY: lint-py
lint-py:  ## flake8 critical-only, matching CI
	python3 -m flake8 app/ --count --select=E9,F63,F7,F82 --show-source --statistics
