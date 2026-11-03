<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- Fork is fully static: no backend, no Cloud, no AI gateway; data lives in localStorage and AI calls go browser-direct to a keyless free provider (default) or user-keyed providers (why: must cost $0 and host on any static host).
- Tree logic lives in src/lib/fork-tree.ts as pure immutable functions with tests (why: alternation and lane rules are the core invariants).
- Provider calls must treat a retired/unavailable model as a model problem, not a key problem: try a newest-first candidate list and honour the replacement model id the provider names in its error, remembering the working one (why: providers retire model ids for newer accounts and a hard-coded id silently breaks them).
- Branches start only from an explicit Branch click (node.branch=true always opens a new lane); the main box continues the current branch. Topic detection (fork-tree.ts topicBranchPoint/splitByTopic) is used only by the manual "Find branches by topic" action (why: users expect basic-chat behaviour and silent auto-moves were confusing).
- Provider calls stream replies (SSE, JSON fallback) and use timedFetch time limits; the Settings test uses quick mode (short limit, no slow retries) (why: replies felt slow and the key test could hang).
