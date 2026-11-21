# 18. Business context as units

[Plan 11](../docs/superpowers/plans/2026-11-21-ctxlock-business-units.md) opens Phase 4: the context agents need about a business, not about code. Satyam's instruction, on 2026-11-21, was again "continue the work", so the open calls were mine. Each is a decision, D100 to D105.

## What exists now

- **Two new kinds of unit:**
  - **`knowledge`:** an OKF 0.2 concept;
  - **`metric`:** an Apache Ossie 0.3.0.dev0 model.

  They are found from `knowledge:` and `metrics:` in `ctxlock.yaml`, from the formats' own marks, and from `ctxlock.lock`.
- **`L17-format`** checks a concept against OKF's rules, and a model against Ossie's own JSON Schema, vendored with its ASF header and NOTICE. Ajv is the one new runtime dependency.
- **A concept's `verified` and `stale_after` are its trust dates,** and `L17-trust-differs` says when `ctxlock.yaml` disagrees.
- **A concept's links to other units are graph edges.**
- **Both kinds sync,** as one file each.
- **A probe can expect an `answer`.**
- **Phase 4 is three plans** (D100). `procedure` is a skill (D101).
- **The suite** has 740 tests.

## What worked

**Reading the formats from their sources first.** The notes from 2026-11-05 were three weeks old, and a research pass found them out of date:
- Ossie had gone from 0.2.0.dev0 to 0.3.0.dev0.
- It had renamed `custom_extensions` to `nonportable_extensions` eleven days before.
- It had dropped the `semantic_model` wrapper.
- A metric in it has no dimensions: a segment is a dataset field.

A plan written from the notes would have checked models against a schema Ossie no longer has.

**Testing against the formats' own examples.** The fixtures are OKF's Appendix A bundle and Ossie's spec example and retail model, pinned by commit. Live, all 53 of Google's sample concepts and all 22 of Ossie's own models passed `L17`. A check that flags the format's own examples would be noise.

**Mutation found two things worth knowing:**
- A JSON branch in the model reader did nothing, since YAML 1.2 reads JSON. It went.
- Several cases were missing: a non-Markdown file in a bundle, a bare `verified` mapping with a bad time, a link through a symlink, and a rule with OKF-looking frontmatter.

## What didn't, at first

- **Google's own bundles don't declare `okf_version`.** That marker was meant to be how a bundle says what it is, yet in practice naming the folder is the way.
- **A scan of a folder inside a repository read the repository.** That is how ctxlock has always worked, but the first live scan found nothing, and the reason took a debugging pass. The guide now says `ctxlock.yaml` sits at the repository's root.
- **One of three base runs passed an answer probe it should have failed.** Every reply checked by hand was right and said there was no segment field. The likely cause is a reply naming `customers.segment` as the field to add. An answer pattern has to match only the right answer. The guide says so, with the remedy.
- **Escaped newlines in a script, again.** A test generator passed `\n` through a heredoc, and it came out as a real newline in three test files at once. The fix was the Edit tool, the same lesson as before.

## Next

Plan 12 serves these units over MCP, with a `report_context_gap` tool whose reports reach `misses`, and runs eval with that server attached.
