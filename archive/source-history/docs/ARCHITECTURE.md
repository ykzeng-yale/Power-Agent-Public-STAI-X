# Multi-Agent Architecture Design

## Overview
This application follows the **Orchestrator-Worker Pattern** for multi-agent coordination, allowing independent, reusable agents that can be composed for complex tasks.

## Agents

### 1. Data Manager Agent (`/api/analyze-file`)
**Role**: Orchestrator
**Responsibility**: Content classification and routing

**Workflow**:
1. Receives uploaded file
2. Uses AI (Claude Haiku 4.5) to classify content as "data" or "document"
3. Routes based on classification:
   - **Data files** → Delegates to Biostatistics Coding Agent
   - **Documents** → Uses Claude API for text analysis

**Key Feature**: Does NOT execute code directly - delegates to specialized agents

### 2. Biostatistics Coding Agent (`/api/analyze-biostat`)
**Role**: Worker
**Responsibility**: R code execution with iteration and error fixing

**Modes**:
- `full_analysis` (default): Complete workflow with PI routing, iteration, streaming
- `preliminary_analysis`: Fast, simplified analysis for file uploads

**Key Feature**: Fully independent and reusable - can be called by any agent or directly by users

### 3. PI (Planning/Inference) Agent (`pi-agent.js`)
**Role**: Worker
**Responsibility**: Query routing (direct answer vs code execution)

**Workflow**:
1. Analyzes user query
2. Decides: "Can I answer directly?" or "Need code execution?"
3. Returns decision to calling agent

## Design Patterns

### Orchestrator-Worker Pattern
```
┌─────────────────────────────┐
│   Data Manager Agent        │  Orchestrator
│   (Content Classification)  │
└──────────┬──────────────────┘
           │
           ├─ Data → ┌────────────────────────────┐
           │         │ Biostatistics Coding Agent │  Worker
           │         │  (R Code Execution)        │
           │         └────────────────────────────┘
           │
           └─ Document → Claude API
```

### Sequential Orchestration
```
User Request
    ↓
Data Manager Agent (classifies content)
    ↓
Coding Agent (executes R code)
    ↓
Results returned to user
```

## Key Benefits

1. **Separation of Concerns**
   - Each agent has a single, well-defined responsibility
   - No code duplication

2. **Reusability**
   - Coding agent can be called by:
     - Data Manager Agent (preliminary analysis)
     - Frontend directly (full analysis)
     - Future agents (specialized analyses)

3. **Independence**
   - Each agent operates autonomously
   - Agents communicate via standard API calls
   - Easy to test, modify, or replace individual agents

4. **Extensibility**
   - New agents can be added easily
   - Existing agents can call new agents
   - Framework supports growth

## Backward Compatibility

All existing functionality is preserved:
- `/api/analyze-biostat` works unchanged for direct calls
- `/api/analyze-file` behavior is unchanged for users
- Internal architecture improved without breaking APIs

## Future Extensions

Potential new agents:
- **Visualization Agent**: Specialized plot generation
- **Report Generation Agent**: Create formatted reports
- **Data Cleaning Agent**: Automated data preprocessing
- **Model Selection Agent**: Choose optimal statistical models

All can reuse the Biostatistics Coding Agent for R execution!
