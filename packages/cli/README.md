# @thinkbrew/cli

Command-line interface for managing ThinkBrew context. Binary: `think`.

## Install

```bash
cd packages/cli
pnpm build
npm link  # makes `think` available globally
```

## Commands

### Initialize

```bash
think init                          # Init ThinkBrew in current directory
think init -n "My Project"          # With custom name
think init -d "Description here"    # With description
```

Creates a `.thinkbrew` marker file with the project ID.

### Projects

```bash
think project list                  # List all projects
think project create "My App"       # Create a project
think project create "My App" -d "A web app"
think project show <id>             # Show project details (accepts ID or name)
think project delete <id>           # Delete a project
```

### Context Entries

```bash
think context list <projectId>                    # List all context
think context list <projectId> -c architecture    # Filter by category
think context add <projectId> "stack" "React 18 + TypeScript"
think context add <projectId> "db" "PostgreSQL 16" -c dependencies -p 3
think context update <id> -v "React 19 + TypeScript"
think context remove <id>
think context search <projectId> "react"
```

Categories: `architecture`, `requirements`, `dependencies`, `standards`, `general`

Priority: 1 (low) to 4 (critical)

### Decisions

```bash
think decision list <projectId>
think decision add <projectId> "Use PostgreSQL" "Chose PostgreSQL for relational integrity"
think decision add <projectId> "Use PostgreSQL" "..." -r "ACID compliance needed" -a "MongoDB, DynamoDB"
think decision update <id> -s deprecated
think decision remove <id>
```

Status: `active`, `deprecated`, `superseded`

### Export

```bash
think export <projectId>                     # Export as markdown (default)
think export <projectId> -f copilot          # Export as .github/copilot-instructions.md
think export <projectId> -f claude           # Export as CLAUDE.md
think export <projectId> -f cursor           # Export as .cursorrules
think export <projectId> -f json             # Export as JSON
think export <projectId> --stdout            # Print to stdout
think export <projectId> -o custom-path.md   # Custom output path
```

### Sync

```bash
think sync <projectId>    # Export to copilot + claude + cursor configs at once
```

This writes:

- `.github/copilot-instructions.md`
- `CLAUDE.md`
- `.cursorrules`

## Data

Stored in `~/.thinkbrew/data.sqlite`. Shared with MCP server and VS Code extension.
