---
name: project-brief
description: Turn a rough idea ("bana X programı geliştir") into a complete, buildable PROJECT_BRIEF.md by interviewing the user about goal, method, scope, stack, data, constraints and acceptance tests. Use FIRST whenever the user asks you to build software - a program, app, game, website, tool or bot ("bana ... yap", "... geliştir", "kod pipeline'ını test et") - then hand over to hybrid-dev.
metadata:
  {
    "openclaw": { "emoji": "📋" }
  }
---

# Project brief

Goal: a brief good enough that another agent can build the project without asking anything else.
Talk to the user in Turkish; write the brief file in English (code-facing).

## Process

1. Read what the user gave. Fill every field of the template you can infer.
2. Ask only for what is missing or ambiguous, **max 6 questions per round**, numbered, each with your recommended
   default ("Önerim: ... - onaylıyor musun?"). Push back on unrealistic scope or a wrong assumption and say why.
3. Repeat until no field is "TBD", or the user says "varsayılanlarla devam".
4. Write `PROJECT_BRIEF.md` at the project root (create `{{PROJECTS_DIR}}\<slug>` if no folder given,
   `git init` it).
5. **Unstated expectations - ask the user first.** Think like a typical user of this kind of product: what would
   they expect that the brief does not say (e.g. a driving game: speedometer, engine sound, wheels, lane markings,
   minimap, reset when stuck)? Show the user, in Turkish: a 5-line summary of the brief, your numbered list of
   unstated expectations (max 8, each with "Önerim: v1'e dahil | sonra"), and the full "Kapsam dışı" list. Ask:
   "Hangilerini v1'e ekleyeyim? (numaralar / 'önerilenler' / 'hiçbiri' / 'Claude'a sor')".
   In the same turn start the 5-minute fallback, detached (it asks the critic agent and sends the result to Telegram
   if the user does not answer in time):
   ```powershell
   Start-Process -WindowStyle Hidden -FilePath python -ArgumentList '{{MERGEN_HOME}}\hybrid\hybrid_run.py','{{PROJECTS_DIR}}\<slug>','--critique-after','300'
   ```
   - **User answers** with picks -> first run `New-Item -Force {{PROJECTS_DIR}}\<slug>\.hybrid\brief_answered`
     (stops the fallback), then go to step 6.
   - **User says "Claude'a sor" / "ajana sor"** -> create the same marker, then run the critic in the foreground:
     `python {{MERGEN_HOME}}\hybrid\hybrid_run.py {{PROJECTS_DIR}}\<slug> --critique-only`
     (add `--brain local` for fully local). Show `BRIEF_REVIEW.md`, say in one line where you disagree, ask again.
   - **User comes back after the timeout** -> `BRIEF_REVIEW.md` exists: show it and ask which items to add.
   The critic only suggests; nothing goes into the brief without the user's pick.
6. Update PROJECT_BRIEF.md (scope, acceptance tests, milestones) with the user's picks. On approval, hand over:
   "hybrid-dev ile başlatayım mı?"

Never drop something silently: every feature you leave out goes into "Out" and is shown to the user.
"Small test" / "küçük" means few milestones, not a bare product: keep what makes it feel complete for its type.

## User defaults (apply unless told otherwise)

- Local-first: no customer/ERP/personal data to cloud APIs; flag any cloud dependency.
- Secrets only in environment variables; `.env` in `.gitignore`.
- Read-only connections to production databases; own data in a separate schema/DB.
- Numbers (totals, VAT, scores) computed deterministically in code/SQL, never by the LLM.
- Prefer Apache-2.0/MIT dependencies; check licenses of models.
- Simple, readable code with config at the top; tests for the core logic.
- Stacks the user knows: Python (Flask/FastAPI), T-SQL/MSSQL, C#/.NET (ASP.NET Core, Blazor, SQLite), some R.

## Template (PROJECT_BRIEF.md)

```markdown
# <Project name>

## 1. Goal
One paragraph: what problem, for whom, what "done" looks like.

## 2. Users and use cases
- <role>: <what they do> (3-7 bullets)

## 3. Scope
**In (v1):** ...
**Out (later / never):** ...

## 4. Method / architecture
Components, data flow, where the LLM is used (language layer only) and where logic is deterministic.

## 5. Stack and environment
Language, frameworks, DB, model/serving (local Strata 127.0.0.1:8080 or other), OS, run command.

## 6. Data
Sources, formats, sample data or synthetic data plan, privacy class (public / personal / customer).

## 7. Interfaces
CLI / API endpoints / UI screens, with inputs and outputs.

## 8. Constraints
Performance, VRAM/RAM budget, offline needs, licenses, security, deadlines.

## 9. Acceptance tests
Numbered, checkable statements ("Given X, running Y outputs Z"). These become the test suite.

## 10. Milestones
M1 ... M4, each small enough to build and test in one sitting.

## 11. Open questions / risks
```
