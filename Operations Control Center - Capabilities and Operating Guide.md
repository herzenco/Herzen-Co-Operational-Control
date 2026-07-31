# Herzen Co. Operations Control Center

> **Implementation note:** This original product guide includes early roadmap
> language that predates the live Supabase/API implementation. Lupe should use
> [`docs/LUPE_HANDOFF_AND_ROADMAP.md`](docs/LUPE_HANDOFF_AND_ROADMAP.md) as the
> current source of truth for implemented capabilities, content governance, and
> next priorities.

## Capabilities and operating guide

**Product owner:** Tito Valenzuela  
**Primary operator:** Lupe  
**Purpose:** Give Tito and the Herzen Co. agent roster one place to receive instructions, coordinate work, document progress, manage approvals, and report outcomes.

---

## 1. What the Operations Control Center is

The Operations Control Center is the shared operating layer for Tito, Lupe, and the Herzen Co. agent team.

It is designed to answer five questions at any moment:

1. What needs to be done?
2. Who owns it?
3. What is moving, blocked, or awaiting review?
4. What did each agent accomplish?
5. What requires Tito’s attention or approval?

The product is organized around agent ownership, instructions, task execution, approvals, and daily reporting rather than generic project management.

---

## 2. Current agent roster

### Lupe

**Role:** Main operator

Lupe coordinates the operating system, translates Tito’s direction into actionable work, monitors execution across lanes, identifies dependencies, and prepares concise updates.

### D8-A

**Role:** Skydeo owner and product or technical operations

D8-A owns Skydeo execution, product work, technical operations, release readiness, onboarding, documentation, and implementation follow-through.

### C-3PO

**Role:** Social media manager and content calendar owner

C-3PO manages social publishing, content schedules, platform coordination, campaign sequencing, and content production status.

### K2

**Role:** Research and optimization for content and social

K2 performs research, validates content strategy, recommends optimizations, reviews supporting evidence, and signs off on packages before they reach Tito.

### Rex

**Role:** Paid media specialist

Rex manages paid acquisition, campaign structure, targeting, creative tests, performance monitoring, budget pacing, and optimization recommendations.

---

## 3. Command center

The command center is the top-level view of the operation.

### At-a-glance operating metrics

The dashboard can surface:

- Active work
- Work awaiting review
- Work completed during the current week
- Daily updates received
- Agents who have not reported
- High-priority work due today
- Approval packages requiring Tito’s attention

### Team status

The team area shows:

- Every active agent
- The agent’s operating lane
- Current focus
- Number of open items
- Most recent activity or update
- Whether the agent has submitted a daily update

### Work in motion

The main workspace combines work from every agent and project. Tito can review the operation as a whole or filter down to one agent.

---

## 4. Instructions

Tito can create a new instruction and assign it directly to an agent.

An instruction can include:

- Clear title
- Detailed context
- Expected outcome
- Definition of done
- Assigned agent
- Project or workstream
- Priority
- Due date
- Constraints
- Supporting links
- Reference material
- Approval requirements

### Instruction workflow

1. Tito creates an instruction.
2. The instruction enters the assigned agent’s inbox.
3. The agent acknowledges the instruction.
4. The agent moves it into active work.
5. The agent documents progress in the work log.
6. The agent submits the result for review when required.
7. K2 signs off when the work is content, research, or optimization related.
8. The approval package goes to Tito.
9. Tito approves, requests changes, or closes the work.

---

## 5. List view

List view is the fastest way to scan and manage work across the operation.

Each row can show:

- Task or instruction
- Project
- Owner
- Status
- Priority
- Due date
- Review state
- Approval state

### List-view actions

Users can:

- Search work by title or project
- Filter work by agent
- Review ownership
- Change task status
- Mark work complete
- Identify overdue or due-today work
- Open an agent’s space
- Move from a team-wide view to an individual lane

---

## 6. Kanban view

Kanban view shows work as it moves through the operating process.

### Standard columns

- **Inbox:** New instructions that have not started
- **In progress:** Work currently being executed
- **Review:** Work waiting for quality review, sign-off, or approval
- **Done:** Completed and accepted work

### Kanban actions

Users can:

- See workload by stage
- Review task context without opening a full record
- Move work forward through the workflow
- Add a new instruction to a lane
- Identify bottlenecks in review
- Compare how much work each agent has in progress

---

## 7. Calendar view

Calendar view places instructions, deadlines, reviews, publishing dates, launches, and meetings on a shared timeline.

The calendar can support:

- Task due dates
- Content publishing dates
- Social campaign schedules
- Paid-media launches
- Review deadlines
- Approval dates
- Product releases
- Research delivery dates
- Recurring daily and weekly reports

### Calendar actions

Users can:

- Review work by day or week
- See which agent owns each scheduled item
- Open the related agent space
- Detect conflicts and deadline concentration
- Coordinate content, product, and paid-media work

---

## 8. Agent spaces

Every agent has a dedicated operating space.

### Agent overview

The overview can show:

- Role and operating lane
- Current focus
- Open work
- Progress
- Today’s priorities
- Items awaiting review
- Recent activity
- Reporting status

### Instructions

The instruction area can contain:

- New instructions from Tito or Lupe
- Acknowledged instructions
- Questions or clarification requests
- Dependencies
- Due dates
- Definition of done

### Work log

Agents can document:

- Actions completed
- Research performed
- Decisions made
- Files created
- Links reviewed
- Changes implemented
- Tests or validation completed
- Problems encountered
- Dependencies discovered
- Next steps

### Updates

Each agent can submit:

- Daily update
- Weekly summary
- Completion report
- Blocker report
- Approval package
- Recommendation
- Request for clarification

---

## 9. Daily brief

The daily brief gives Tito a concise operational readout without requiring him to inspect every task.

### Daily brief contents

- Work moved forward
- Work completed
- Work blocked
- Decisions made
- Items awaiting review
- Items awaiting Tito’s approval
- Missed or approaching deadlines
- Agent updates received
- Agents who have not reported
- Priorities for the next work period

### Recommended agent update format

Each agent should report:

1. **Completed:** What was finished today
2. **Moved forward:** What materially progressed
3. **Blocked:** What cannot proceed and why
4. **Needs review:** What is ready for another agent or Tito
5. **Next:** The first priority for the next work period

### Lupe’s daily update

Lupe’s report should also include:

- Cross-agent dependencies
- Conflicting priorities
- Capacity concerns
- Approval queue summary
- Recommended decisions for Tito
- Tomorrow’s proposed operating plan

---

## 10. Review and approval workflow

The Control Center is intended to prevent incomplete or low-confidence work from reaching Tito.

### Standard review path

1. Agent completes the work.
2. Agent documents evidence and deliverables.
3. Work moves to review.
4. K2 reviews content, research, optimization, and supporting rationale when applicable.
5. The reviewing agent either signs off or requests changes.
6. Approved work becomes an approval package.
7. Tito approves, requests revisions, or declines.
8. The final decision and rationale are recorded.

### Approval package contents

- Requested decision
- Executive summary
- Deliverable or link
- Supporting evidence
- Agent recommendation
- Risks or tradeoffs
- K2 sign-off when required
- Deadline for the decision
- Consequence of no decision

---

## 11. Search and filtering

The Control Center supports fast retrieval across work, agents, and projects.

Users can search or filter by:

- Task title
- Project
- Agent
- Status
- Priority
- Due date
- Review state
- Approval state
- Content campaign
- Product workstream
- Paid-media campaign

---

## 12. Project and workstream organization

Work can be grouped into spaces or projects such as:

- Herzen Co.
- Skydeo
- Content
- Social media
- Research and optimization
- Paid media
- Internal operations
- Product launches
- Client delivery

Each project can contain:

- Overview
- Objectives
- Current priorities
- Instructions
- Tasks
- Timeline
- Documents
- Decisions
- Work logs
- Risks
- Approvals
- Reports

---

## 13. Documentation and operating memory

The Control Center can become the operational memory for Herzen Co.

It can preserve:

- Original instructions
- Changes in scope
- Agent questions
- Work logs
- Supporting research
- Decisions and rationale
- Approval history
- Rejected approaches
- Deliverables
- Completion evidence
- Daily and weekly reports

This creates a reliable record of what happened, who decided it, and why.

---

## 14. Notifications and attention management

The notification system can surface:

- New instructions
- Assignment changes
- Due-today work
- Overdue work
- Review requests
- Requested revisions
- Agent blockers
- K2 sign-offs
- Approval requests
- Tito decisions
- Missing daily updates

The goal is to direct attention to exceptions and decisions rather than generate noise.

---

## 15. Reporting and performance visibility

The Control Center can support operational reporting across agents and lanes.

### Team reporting

- Work completed by period
- Work completed by agent
- Average time in each status
- Review turnaround time
- Approval turnaround time
- Overdue work
- Reopened work
- Blocked work
- Update submission rate

### Lane-specific reporting

**Product and technical operations**

- Release readiness
- Open product decisions
- Technical dependencies
- Documentation coverage
- Delivery milestones

**Content and social**

- Publishing cadence
- Calendar completion
- Content status
- Platform coverage
- Review and approval timing

**Research and optimization**

- Research delivered
- Recommendations accepted
- Optimization tests
- Sign-off turnaround
- Evidence quality

**Paid media**

- Campaigns active
- Tests launched
- Budget pacing
- Creative performance
- Optimization actions

---

## 16. Roles and permissions

The intended permission model can support:

### Tito

- Full visibility
- Create instructions
- Change priorities
- Approve or reject work
- Review all reports
- Manage agents and spaces

### Lupe

- Full operational visibility
- Translate direction into instructions
- Assign and coordinate work
- Monitor deadlines and blockers
- Prepare daily and weekly briefs
- Escalate decisions

### Specialist agents

- View assigned work and relevant project context
- Document work
- Update status
- Submit deliverables
- Raise blockers
- Request review
- Submit daily updates

### K2

- Specialist permissions plus review and sign-off authority for applicable packages

---

## 17. Current implemented release

The current product release includes:

- Herzen Co. branded command center
- Team roster for Lupe, D8-A, C-3PO, K2, and Rex
- At-a-glance operational metrics
- List view
- Kanban view
- Calendar view
- Search
- Agent filtering
- Agent-space drawers
- New-instruction form
- Task status progression
- Task-completion controls
- Daily brief drawer
- Responsive desktop and mobile layouts
- Supabase browser and server client foundation
- Supabase session-refresh proxy
- Private hosted deployment

### Current implementation boundary

The present release is an interactive product foundation. Some actions update the current interface but are not yet stored as durable multi-user records.

The next backend phase must connect the interface to authenticated Supabase tables, Row Level Security policies, and agent-facing APIs before the Control Center becomes the authoritative system of record.

---

## 18. Next implementation phase

### Durable data

- Create Supabase tables for agents, projects, tasks, instructions, updates, comments, decisions, approvals, and activity
- Add stable record IDs and timestamps
- Persist all task and instruction changes
- Add audit history

### Authentication

- Add sign-in
- Associate users and agents with profiles
- Restrict access by role
- Protect every exposed table with Row Level Security

### Agent integration

- Give each agent a secure method to read assigned instructions
- Allow agents to post status changes and work logs
- Allow agents to submit daily updates
- Allow agents to upload or link deliverables
- Allow Lupe to coordinate work across agents

### Approval system

- Create review requests
- Add K2 sign-off
- Build approval packages
- Capture Tito’s decision and feedback
- Maintain approval history

### Reporting automation

- Automatically request daily updates
- Compile agent updates into Lupe’s brief
- Flag missing reports
- Generate weekly operating summaries
- Track overdue work and recurring blockers

### Files and evidence

- Add attachments
- Store deliverable links
- Associate files with tasks and approvals
- Maintain version history

---

## 19. Recommended operating cadence

### Start of day

- Lupe reviews overdue and due-today work
- Lupe confirms priorities and dependencies
- Agents acknowledge assignments
- Tito reviews only escalated decisions

### During the day

- Agents update status when work materially changes
- Agents document evidence in work logs
- Blockers are raised immediately
- Review packages move through K2 before Tito when required

### End of day

- Every agent submits an update
- Lupe compiles the daily brief
- Missing updates and unresolved blockers are flagged
- Tito receives the concise decision and approval queue

### Weekly

- Review completed work
- Review recurring blockers
- Rebalance agent capacity
- Confirm the next week’s priorities
- Archive closed work with its documentation

---

## 20. Definition of success

The Operations Control Center is successful when:

- Tito can understand the state of the operation in a few minutes
- Every instruction has a clear owner and outcome
- Agents know what to do next
- Work is documented as it happens
- Blockers surface early
- Review happens before approval
- Tito receives concise decision-ready packages
- Daily updates arrive consistently
- Completed work creates reusable operating memory
- The system reduces coordination overhead instead of adding it

---

## 21. Product principle

The Control Center should make the work legible.

It should show what matters, hide unnecessary noise, and give every agent a clear path from instruction to documented outcome.
