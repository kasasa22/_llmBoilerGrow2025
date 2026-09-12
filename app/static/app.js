/**
 * Chat UI SSE client. Handles submit + EventSource with Last-Event-ID replay.
 * Renders per-phase events with terse labels; unknown phases still render.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const queryEl = $("query");
  const submitEl = $("submit");
  const jobBadge = $("job-badge");
  const traceBadge = $("trace-badge");
  const eventsEl = $("events");
  const answerSection = $("answer-section");
  const answerEl = $("answer");
  const citationsEl = $("citations");
  const errorBanner = $("error-banner");

  let source = null;
  let currentJobId = null;
  let lastSeqByJob = new Map();

  submitEl.addEventListener("click", onSubmit);
  queryEl.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") onSubmit();
  });

  async function onSubmit() {
    const query = queryEl.value.trim();
    if (!query) return;
    resetUi();
    submitEl.disabled = true;

    let payload;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      payload = await res.json();
      const traceId = res.headers.get("x-trace-id");
      if (traceId) {
        traceBadge.textContent = "trace " + traceId.slice(0, 8);
        traceBadge.title = "trace_id: " + traceId;
        traceBadge.classList.remove("hidden");
      }
      if (!res.ok) {
        return showError(`${res.status} ${payload.error || "error"}: ${payload.message || ""}`);
      }
    } catch (err) {
      submitEl.disabled = false;
      return showError("Network error submitting query.");
    }

    currentJobId = payload.job_id;
    jobBadge.textContent = payload.job_id;
    jobBadge.classList.remove("hidden");
    if (payload.idempotent) pushEvent("dedup", `Reusing existing job (${payload.job_id})`);

    connectStream(payload.stream_url);
    submitEl.disabled = false;
  }

  function connectStream(url) {
    if (source) source.close();
    source = new EventSource(url);

    ["job.started", "queued", "step.started", "step.completed", "agent.transition",
     "tool.called", "tool.result", "tool.error", "agent.thought",
     "research.source_found", "research.search_completed",
     "analysis.claim_extracted", "analysis.source_scored",
     "synthesis.started", "synthesis.answer_ready",
     "rag.chunks_indexed", "rag.retrieved", "rag.circuit_open",
     "citation.added", "citation", "budget.hit",
     "final", "error", "network.error", "done"
    ].forEach((phase) => source.addEventListener(phase, (e) => handleEvent(phase, e)));

    source.onerror = () => {
      // EventSource auto-reconnects; note it and continue.
      pushEvent("reconnecting", "Connection dropped, retrying...");
    };
  }

  function handleEvent(phase, e) {
    let envelope = null;
    try { envelope = JSON.parse(e.data); } catch (_) { return; }
    const seq = envelope.seq;
    if (typeof seq === "number") {
      const seen = lastSeqByJob.get(currentJobId) ?? -1;
      if (seq <= seen) return;
      lastSeqByJob.set(currentJobId, seq);
    }
    dispatch(phase, envelope);
  }

  function dispatch(phase, envelope) {
    const data = envelope.data || {};
    switch (phase) {
      case "final": return onFinal(data);
      case "done": return pushEvent("done", "Stream complete.");
      case "error":
      case "network.error":
        return pushEvent(phase, `${data.code || "ERROR"}: ${data.message || "unknown"}`, "error");
      case "citation.added":
      case "citation":
        return pushEvent(phase, describeCitation(data), "citation-added");
      case "tool.called":
        return pushEvent(phase, `→ ${data.tool || "?"}${data.args ? " " + summariseArgs(data.args) : ""}`, "tool-called");
      case "tool.result":
        return pushEvent(phase, `← ${data.tool || "?"}${data.summary ? ": " + data.summary : " done"}`);
      case "tool.error":
        return pushEvent(phase, `× ${data.tool || "?"}: ${data.message || data.code || "error"}`, "error");
      case "agent.transition":
        return pushEvent(phase, `${data.from || "?"} → ${data.to || "?"} (${data.phase || "?"})`, "agent-transition");
      case "research.source_found":
        return pushEvent(phase, describeSource(data), "research-source-found");
      case "rag.chunks_indexed":
        return pushEvent(phase, `Indexed ${data.chunkCount ?? "?"} chunks (${data.embedded ? "embedded" : "raw"})`);
      case "rag.retrieved":
        return pushEvent(phase, `Retrieved top-${data.k ?? "?"} (score ≥ ${data.minScore ?? "?"})`);
      case "rag.circuit_open":
        return pushEvent(phase, `Embedder circuit open: ${data.reason || "?"}`, "rag-circuit-open");
      case "budget.hit":
        return pushEvent(phase, `Budget limit reached: ${data.limit || "?"}`, "budget-hit");
      default:
        return pushEvent(phase, JSON.stringify(data));
    }
  }

  function onFinal(data) {
    const answer = data.answer || "(no answer)";
    answerEl.innerHTML = renderMarkdownLite(answer);
    citationsEl.innerHTML = "";
    (data.citations || []).forEach((c) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = c.url;
      a.textContent = c.title || c.url;
      a.target = "_blank";
      a.rel = "noopener";
      li.appendChild(a);
      citationsEl.appendChild(li);
    });
    answerSection.classList.remove("hidden");
    pushEvent("final", data.partial ? "Partial answer (budget exhausted)" : "Final answer ready.", "final");
  }

  function pushEvent(phase, text, className) {
    const li = document.createElement("li");
    if (className) li.classList.add(className);
    else li.classList.add(phaseToClass(phase));
    const p = document.createElement("span");
    p.className = "phase";
    p.textContent = phase;
    const d = document.createElement("span");
    d.className = "detail";
    d.textContent = text;
    li.appendChild(p); li.appendChild(d);
    eventsEl.appendChild(li);
    eventsEl.scrollTop = eventsEl.scrollHeight;
  }

  function phaseToClass(phase) { return phase.replace(/\./g, "-"); }

  function describeSource(data) {
    if (!data) return "source found";
    return `${data.title || data.url || "source"}${data.url ? " — " + data.url : ""}`;
  }
  function describeCitation(data) {
    if (!data) return "citation";
    return `[${data.n ?? "?"}] ${data.title || data.url || "cited"}`;
  }
  function summariseArgs(args) {
    const s = JSON.stringify(args);
    return s.length > 120 ? s.slice(0, 117) + "..." : s;
  }

  function renderMarkdownLite(md) {
    // Ultra-minimal markdown: escape, preserve paragraphs, honour [n] cite refs.
    const esc = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return esc.split(/\n\n+/).map((p) => "<p>" + p.replace(/\n/g, "<br>") + "</p>").join("");
  }

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.classList.remove("hidden");
    submitEl.disabled = false;
  }

  function resetUi() {
    errorBanner.classList.add("hidden");
    answerSection.classList.add("hidden");
    answerEl.innerHTML = "";
    citationsEl.innerHTML = "";
    eventsEl.innerHTML = "";
  }
})();
