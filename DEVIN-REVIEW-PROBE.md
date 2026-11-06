# Automatic review enrollment probe

This temporary documentation-only change verifies that automatic pull request
review publishes a genuine `Devin Review` commit status on a fresh head.

It changes no application code, dependencies, workflows, configuration or runtime
resources. The pull request is disposable and must be closed without merging once
its observed status has been recorded. No manual review command is required.
