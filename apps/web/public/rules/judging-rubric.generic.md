# Judging rubric: generic (human-readable)

> Neutral counterpart of [`judging-rubric.generic.yaml`](./judging-rubric.generic.yaml).
> Same four weighted criteria and the same 0–100 scale, with no organiser or
> vendor name. Either this file or the YAML can be uploaded as-is.

## Scoring scale

Each criterion is scored from **0 to 100** by every evaluator, independently,
with at least one piece of evidence per criterion.

| Range | Label | Meaning |
| --- | --- | --- |
| 0–19 | Absent | No credible evidence, or contradicted by the artefacts |
| 20–39 | Weak | Mentioned but shallow, generic, or only partly working |
| 40–59 | Adequate | Present and functional, but conventional |
| 60–79 | Strong | Thoughtful, well executed, clearly evidenced |
| 80–100 | Exceptional | Distinctive, surprising, production-grade or novel |

## Criteria

| Category (Weight) | Description |
| --- | --- |
| **Impact (30%)** | What's the real-world potential here? Who benefits, and how much does it matter? Could this actually become something people use? Does it fit into one of the problem statements listed above? |
| **Use of AI Tooling (25%)** | How creatively did this team use AI tooling? Did they go beyond a basic integration? Did they surface capabilities that were unexpected or genuinely inventive? |
| **Technical Depth & Execution (20%)** | Is the engineering sound and thoughtfully refined? Does this feel like something that was thought through with real craft. |
| **Demo (25%)** | Is this a working, impressive demo? Does the product hold up live? Is the demo video genuinely cool to watch? |

## Ranking

- Rank **inside each track**, with a separate global view.
- Primary key: weighted score.
- One comparative, ordinal pass per track after absolute scoring.
- Tie-breakers: Impact, then Demo, then Technical Depth.
- Provided ranks are **never** injected into scoring prompts. They are compared
  after the fact and reported as a rank delta.
- The operator may choose 1–3 projects as calibration anchors. Anchors are
  ranked normally; other projects are positioned relative to them without using
  any numeric rank from the manifest.

## Consensus

- 6 evaluator agents score independently.
- One cross-review round: each agent sees the other five anonymised evaluations,
  then may revise with a written justification.
- Consensus uses a trimmed mean (drop the highest and lowest, average the rest).
- Dispersion is measured with the median absolute deviation. Above **8 points**,
  the verifiers arbitrate instead of silently averaging.
- 2 verifier agents audit the six evaluations, then reconcile the final
  criterion scores and ranking. A verifier may move a score by at most
  **10 points**, with justification.
- Unresolved disagreements are surfaced to the operator.
