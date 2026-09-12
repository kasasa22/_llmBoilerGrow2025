# Evaluation harness

Repeatable numbers for the multi-agent research pipeline.

## Local

```
make up
make pull-models     # once
make eval            # writes eval/results/<date>.md
```

By default the driver hits `http://localhost:8080`. Set a different target
with `EVAL_URL=`:

```
EVAL_URL=http://<lb-ip> make eval
```

## Cluster (GitHub Actions)

Trigger the `Evaluation harness` workflow via the Actions tab. Inputs:

- `url` — base URL (defaults to `secrets.EVAL_URL`).
- `fail_under` — CI gate on mean `citations_from_expected_domains`.

Results markdown is uploaded as an artefact and also posted to the run's job
summary.

## Adding a case

Append one JSON line to `eval/dataset.jsonl`:

```
{"id":"q9","query":"...","expected_sources":["example.com"],"expected_facts":["foo"],"must_terminate":true,"timeout_s":120}
```

## Metrics

| Field | Meaning |
|---|---|
| `has_final_answer` | Boolean — did we ever emit a `final` event? |
| `tool_calls` | Total `tool.called` events. |
| `fetches` | Subset of tool_calls where `tool == "fetchUrl"`. |
| `citations_count` | Distinct citations in the final answer. |
| `expected_domain_hit` | Fraction of `expected_sources` whose eTLD+1 shows up in citations. |
| `facts_hit` | Fraction of `expected_facts` substrings present in the answer. |
| `wall_clock_ms` | `ts(done) - ts(first_event)`. |
| `budget_hits` | Number of `budget.hit` events. |
| `errors` | Sum of `error` and `network.error` events. |
