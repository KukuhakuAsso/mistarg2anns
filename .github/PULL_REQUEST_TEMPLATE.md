<!--
  Shared by: ku2hakuasso-admin, mistarg2anns
  Location: .github/PULL_REQUEST_TEMPLATE.md in each frontend repo
-->

## What changed

<!-- 1-3 bullets: what and why -->

-

## Linked issue (closed automatically on merge — required)

Closes KukuhakuAsso/issue#

<!--
  Supported syntax (GitHub native keyword + cross-repo reference):
    Closes KukuhakuAsso/issue#12
    Fixes KukuhakuAsso/issue#12, Closes KukuhakuAsso/issue#15

  ⚠️ Closing rule: the PR must be merged into the DEFAULT branch (main / master).
     Merging into any other branch only syncs the project board, it does not close the issue.
     .github/workflows/pr-project-sync.yml parses the reference above, closes the issue
     after the merge, and syncs the Project 2 status (In Review / Done).
     Branch-name convention works too: feature/issue-12.
-->

## Testing

- [ ] Verified locally / on the preview site
- [ ] No DB changes, or migration is documented
- [ ] Checked that the aggregate site build is not affected (when touching submodules)

## Screenshots / recordings (optional)
