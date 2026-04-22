# Placeholders TODO (PM Delegation Model)

This list tracks commands that still use placeholder handlers and must be implemented via PM-driven delegation to one or more agents.

## Principles

- Commands should delegate orchestration to PM instead of embedding business logic directly in UI handlers.
- UI commands should collect minimal input and call PM orchestration services.
- Keep command names stable for backward compatibility.

## PM-Delegated Backlog (Implemented)

All commands below were migrated from info-only placeholders to PM-delegated functional handlers in `src/extension.ts`.

- [x] thinkcoffee.refreshProjects
- [x] thinkcoffee.createProject
- [x] thinkcoffee.addContext
- [x] thinkcoffee.addFileAsContext
- [x] thinkcoffee.addSelectionAsContext
- [x] thinkcoffee.addStructureAsContext
- [x] thinkcoffee.addDecision
- [x] thinkcoffee.syncContext
- [x] thinkcoffee.exportContext
- [x] thinkcoffee.openContextFile
- [x] thinkcoffee.viewContext
- [x] thinkcoffee.openChat
- [x] thinkcoffee.createPipeline
- [x] thinkcoffee.approvePhase
- [x] thinkcoffee.rejectPhase
- [x] thinkcoffee.viewTaskOutput
- [x] thinkcoffee.refreshPipeline
- [x] thinkcoffee.openOtherProject
- [x] thinkcoffee.configureAgentModels
- [x] thinkcoffee.viewAgentModels
- [x] thinkcoffee.toggleDryRun
- [x] thinkcoffee.openSafetyNet
- [x] thinkcoffee.rollback
- [x] thinkcoffee.listSnapshots
- [x] thinkcoffee.cleanupSnapshots

## Non-Placeholder (Already Wired)

- thinkcoffee.runPhase (delegates to workflow.executeAutonomous)
- thinkcoffee.stopAgents
- thinkcoffee.invokeAgent
- thinkcoffee.workflow.createComplex
- thinkcoffee.workflow.executeAutonomous
- thinkcoffee.orchestrator.showRunStatus
- thinkcoffee.orchestrator.showCheckpoints
- thinkcoffee.orchestrator.pauseRun
- thinkcoffee.orchestrator.resumeRun
- thinkcoffee.orchestrator.selectRun
