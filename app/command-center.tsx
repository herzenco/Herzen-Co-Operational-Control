"use client";

import { useMemo, useState } from "react";

type AgentId = "lupe" | "d8a" | "c3po" | "k2" | "rex";
type Status = "Inbox" | "In progress" | "Review" | "Done";
type View = "command" | "list" | "kanban" | "calendar" | "approvals";
type Drawer = AgentId | "new" | "brief" | null;

type Agent = {
  id: AgentId; name: string; lane: string; role: string; focus: string;
  reported: boolean; last: string; charter: string;
};

type Task = {
  id: number; title: string; project: string; owner: AgentId; status: Status;
  priority: "High" | "Medium" | "Low"; due: string; day: number; note: string;
  review: string; approval: string;
};

const agents: Agent[] = [
  { id: "lupe", name: "Lupe", lane: "Operations", role: "Main operator", focus: "Week 31 brief · dependency map", reported: true, last: "12 min ago", charter: "Turns Tito’s direction into instructions, watches every lane for drift, and owns the daily brief." },
  { id: "d8a", name: "D8-A", lane: "Product + technical ops", role: "Skydeo owner", focus: "Skydeo 2.4 release readiness", reported: true, last: "28 min ago", charter: "Owns Skydeo execution, release readiness, onboarding, technical operations, and documentation." },
  { id: "c3po", name: "C-3PO", lane: "Content + social", role: "Calendar owner", focus: "August calendar · 18 posts", reported: true, last: "1 hr ago", charter: "Runs publishing: the calendar, platform coordination, campaign sequencing, and production status." },
  { id: "k2", name: "K2", lane: "Research + optimization", role: "Quality gate", focus: "Keyword pass · approval evidence", reported: true, last: "42 min ago", charter: "Researches, optimizes, and signs off before applicable packages reach Tito." },
  { id: "rex", name: "Rex", lane: "Paid media", role: "Paid media specialist", focus: "Prospecting test 04 · budget pacing", reported: false, last: "Yesterday", charter: "Owns paid acquisition, campaign structure, creative tests, pacing, and optimization." },
];

const initialTasks: Task[] = [
  { id: 1, title: "Finalize Q3 operating roadmap", project: "Herzen Co.", owner: "lupe", status: "In progress", priority: "High", due: "Today", day: 30, note: "Consolidate every lane and flag dependencies.", review: "Internal", approval: "None" },
  { id: 2, title: "Release readiness pass for Skydeo 2.4", project: "Skydeo", owner: "d8a", status: "Review", priority: "High", due: "Tomorrow", day: 31, note: "Migration rehearsed twice. One open question on the agent API rate limit.", review: "Ready", approval: "Queued" },
  { id: 3, title: "Lock the August content calendar — 18 posts", project: "Content", owner: "c3po", status: "Review", priority: "High", due: "Today · noon", day: 30, note: "Four platforms, three themes. K2 signed the evidence pack.", review: "Signed", approval: "Queued" },
  { id: 4, title: "Competitor hook and keyword research", project: "Growth", owner: "k2", status: "In progress", priority: "Medium", due: "Tomorrow", day: 31, note: "Eleven terms remain after the quality pass.", review: "None", approval: "None" },
  { id: 5, title: "Refresh prospecting creative tests", project: "Paid media", owner: "rex", status: "Inbox", priority: "Medium", due: "Aug 1", day: 1, note: "Test 04 needs one more week before a budget decision.", review: "Pending", approval: "None" },
  { id: 6, title: "Document the agent API in Skydeo docs", project: "Skydeo", owner: "d8a", status: "Inbox", priority: "Medium", due: "Aug 4", day: 4, note: "Blocks external agents from reading their own instructions.", review: "None", approval: "None" },
  { id: 7, title: "Package weekly performance brief", project: "Growth", owner: "k2", status: "Inbox", priority: "Medium", due: "Aug 3", day: 3, note: "Include evidence and recommended action.", review: "None", approval: "None" },
  { id: 8, title: "Schedule founder story sequence", project: "Content", owner: "c3po", status: "In progress", priority: "Medium", due: "Aug 2", day: 2, note: "Seven frames drafted. One proof point is outstanding.", review: "Pending", approval: "None" },
  { id: 9, title: "Audit campaign naming system", project: "Paid media", owner: "rex", status: "Done", priority: "Low", due: "Jul 29", day: 29, note: "Convention documented and applied.", review: "Complete", approval: "None" },
];

const approvals = [
  { id: "AP-031", title: "Publish the August content calendar as locked", owner: "C-3PO", due: "Today · 12:00", signed: "K2 signed", summary: "Eighteen posts across four platforms. Scheduling must begin before the Skydeo 2.4 freeze.", risk: "A late decision compresses production and misses the first August window." },
  { id: "AP-032", title: "Ship Skydeo 2.4 on Thursday", owner: "D8-A", due: "Today · 16:00", signed: "K2 pending", summary: "Two clean migration rehearsals at 41 seconds. One unresolved API rate-limit question remains.", risk: "The rate limit may constrain research agents after launch." },
  { id: "AP-033", title: "Increase prospecting budget by 20%", owner: "Rex", due: "Friday", signed: "K2 withheld", summary: "Test 04 is directionally positive but has not completed a full week.", risk: "Increasing now would outrun the evidence." },
];

const statusOrder: Status[] = ["Inbox", "In progress", "Review", "Done"];
const viewMeta: Record<View, [string, string, string]> = {
  command: ["Live operation", "Command center", "Thursday 30 July · 10:24 · five lanes reporting"],
  list: ["All work", "Instruction ledger", "Every instruction, owner, review, and approval state."],
  kanban: ["Workflow", "Instruction to outcome", "Move work through the operating process."],
  calendar: ["Timeline", "Week 31", "Deadlines, publishing, reviews, and decisions on one line."],
  approvals: ["Decision desk", "Awaiting you", "Evidence packaged. Consequences made explicit."],
};

const calendar = [
  { dow: "Mon", date: 27 }, { dow: "Tue", date: 28 }, { dow: "Wed", date: 29 },
  { dow: "Thu", date: 30 }, { dow: "Fri", date: 31 }, { dow: "Sat", date: 1 }, { dow: "Sun", date: 2 },
  { dow: "Mon", date: 3 }, { dow: "Tue", date: 4 }, { dow: "Wed", date: 5 },
  { dow: "Thu", date: 6 }, { dow: "Fri", date: 7 }, { dow: "Sat", date: 8 }, { dow: "Sun", date: 9 },
];

function AgentMark({ id, large = false }: { id: AgentId; large?: boolean }) {
  const agent = agents.find(a => a.id === id)!;
  return <span className={`agentMark ${large ? "large" : ""}`}>{agent.name.slice(0, 2).toUpperCase()}</span>;
}

export function CommandCenter() {
  const [view, setView] = useState<View>("command");
  const [lane, setLane] = useState<AgentId | "all">("all");
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState(initialTasks);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [dragId, setDragId] = useState<number | null>(null);

  const filtered = useMemo(() => tasks.filter(t => {
    const q = query.toLowerCase();
    return (lane === "all" || t.owner === lane) && (!q || `${t.title} ${t.project}`.toLowerCase().includes(q));
  }), [tasks, lane, query]);
  const activeAgent = agents.find(a => a.id === drawer);
  const meta = viewMeta[view];

  function advance(id: number) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: statusOrder[(statusOrder.indexOf(t.status) + 1) % statusOrder.length] } : t));
  }
  function move(id: number, status: Status) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  }
  function addTask(form: FormData) {
    const title = String(form.get("title") || "").trim();
    if (!title) return;
    setTasks(prev => [{ id: Date.now(), title, project: String(form.get("project")), owner: form.get("agent") as AgentId, status: "Inbox", priority: form.get("priority") as Task["priority"], due: "In 2 days", day: 1, note: String(form.get("dod") || form.get("context") || "Awaiting acknowledgement."), review: form.get("signoff") ? "Required" : "None", approval: "None" }, ...prev]);
    setDrawer(null); setView("kanban");
  }

  return <div className="deck">
    <aside className="rail">
      <div className="deckBrand"><img src="/herzen-logo-white.png" alt="Herzen Co." /><span>Operations control</span></div>
      <div className="rule" />
      <nav className="deckNav">
        {([["command", "Command"], ["list", "List"], ["kanban", "Kanban"], ["calendar", "Calendar"], ["approvals", "Approvals"]] as [View, string][]).map(([id, label]) =>
          <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}><i /><span>{label}</span><em>{id === "list" ? tasks.length : id === "approvals" ? approvals.filter(a => !decisions[a.id]).length : ""}</em></button>
        )}
      </nav>
      <div className="roster">
        <div className="railLabel">Roster</div>
        {agents.map(a => <button key={a.id} onClick={() => setDrawer(a.id)}><AgentMark id={a.id} /><span>{a.name}</span><i className={a.reported ? "online" : ""} /></button>)}
        <p>Operator on duty<br /><b>Lupe</b></p>
      </div>
    </aside>

    <main className="deckMain">
      <header className="deckHeader">
        <div className="titleBlock"><span className="liveLabel"><i />{meta[0]}</span><h1>{meta[1]}</h1><p>{meta[2]}</p></div>
        <div className="headerActions">
          <label className="deckSearch"><span>/</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search work or project" /></label>
          <button className="outlineBtn" onClick={() => setDrawer("brief")}>Daily brief</button>
          <button className="liveBtn" onClick={() => setDrawer("new")}>New instruction</button>
        </div>
        <div className="laneFilters"><span>Lane</span><button className={lane === "all" ? "active" : ""} onClick={() => setLane("all")}>All lanes</button>{agents.map(a => <button key={a.id} className={lane === a.id ? "active" : ""} onClick={() => setLane(a.id)}>{a.name}</button>)}</div>
      </header>

      <div className="deckContent">
        {view === "command" && <div className="commandView">
          <div className="metricDeck">
            {[
              ["Active work", tasks.filter(t => t.status === "In progress").length, "Two moved today"],
              ["Awaiting review", tasks.filter(t => t.status === "Review").length, "One K2 sign-off pending"],
              ["Awaiting you", approvals.filter(a => !decisions[a.id]).length, "Decisions, nothing else"],
              ["Reported", `${agents.filter(a => a.reported).length}/5`, "Rex is quiet"],
            ].map(([label, value, note]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}
          </div>
          <div className="commandGrid">
            <section className="deckPanel teamPanel">
              <div className="panelHead"><div><span>Team status</span><h2>Who is on what, right now</h2></div><small>4 of 5 reported</small></div>
              {agents.map(a => <button className="teamRow" key={a.id} onClick={() => setDrawer(a.id)}><AgentMark id={a.id} large /><span className="agentIdentity"><b>{a.name}</b><small>{a.lane}</small></span><span className="agentFocus">{a.focus}</span><strong>{tasks.filter(t => t.owner === a.id && t.status !== "Done").length}</strong><span className="reportState"><b className={a.reported ? "" : "missing"}>{a.reported ? "Submitted" : "Not submitted"}</b><small>{a.last}</small></span></button>)}
            </section>
            <div className="sideStack">
              <section className="deckPanel">
                <div className="panelHead"><div><span>Awaiting you</span><h2>Decisions, nothing else</h2></div></div>
                {approvals.filter(a => !decisions[a.id]).map(a => <button className="decisionRow" key={a.id} onClick={() => setView("approvals")}><b>{a.title}</b><small>{a.owner} · <i>{a.due}</i> · {a.signed}</small></button>)}
                <button className="textLink" onClick={() => setView("approvals")}>Open approval queue →</button>
              </section>
              <section className="deckPanel">
                <div className="panelHead"><div><span className="dim">Due today</span><h2>{tasks.filter(t => t.due.includes("Today") && t.status !== "Done").length} commitments</h2></div></div>
                {tasks.filter(t => t.due.includes("Today") && t.status !== "Done").map(t => <div className="dueRow" key={t.id}><i /><span><b>{t.title}</b><small>{agents.find(a => a.id === t.owner)?.name} · {t.project}</small></span></div>)}
              </section>
            </div>
          </div>
        </div>}

        {view === "list" && <div className="ledger deckPanel">
          <div className="ledgerHead"><span /><span>Instruction</span><span>Project</span><span>Owner</span><span>Status</span><span>Due</span><span>Review · approval</span></div>
          {filtered.map(t => <div className="ledgerRow" key={t.id}><button className={`squareCheck ${t.status === "Done" ? "done" : ""}`} onClick={() => move(t.id, t.status === "Done" ? "In progress" : "Done")}><i /></button><span className="instruction"><b className={t.status === "Done" ? "struck" : ""}>{t.title}</b><small>{t.priority} priority</small></span><span>{t.project}</span><button className="ownerLink" onClick={() => setDrawer(t.owner)}>{agents.find(a => a.id === t.owner)?.name}</button><button className={`statusPill s${t.status.replace(" ", "")}`} onClick={() => advance(t.id)}><i />{t.status}</button><span className={t.due.includes("Today") ? "urgent" : ""}>{t.due}</span><span className="reviewState"><b>{t.review}</b><small>{t.approval}</small></span></div>)}
          <footer>{filtered.length} of {tasks.length} instructions shown</footer>
        </div>}

        {view === "kanban" && <div className="kanbanDeck">
          {statusOrder.map(status => <section className="kanbanColumn" key={status} onDragOver={e => e.preventDefault()} onDrop={() => { if (dragId) move(dragId, status); setDragId(null); }}>
            <header><span><i />{status}</span><b>{filtered.filter(t => t.status === status).length}</b></header><p>{status === "Inbox" ? "Awaiting acknowledgement." : status === "In progress" ? "Owned and moving." : status === "Review" ? "Evidence and sign-off." : "Accepted outcomes."}</p>
            <div>{filtered.filter(t => t.status === status).map(t => <article draggable key={t.id} onDragStart={() => setDragId(t.id)} onDragEnd={() => setDragId(null)} onClick={() => setDrawer(t.owner)}><header><span>{t.project}</span><em>{t.priority.slice(0, 1)}</em></header><h3>{t.title}</h3><p>{t.note}</p><footer><span><AgentMark id={t.owner} />{agents.find(a => a.id === t.owner)?.name}</span><button onClick={e => { e.stopPropagation(); advance(t.id); }}>Advance →</button></footer></article>)}</div>
            <button className="addInstruction" onClick={() => setDrawer("new")}>Add instruction</button>
          </section>)}
        </div>}

        {view === "calendar" && <div className="calendarDeck deckPanel">
          <div className="calendarBar"><button>←</button><h2>July — August 2026</h2><button>→</button></div>
          <div className="calendarGrid">{calendar.map((d, i) => <div className={`calendarCell ${d.date === 30 ? "today" : ""}`} key={i}><header><span>{d.dow}</span><b>{d.date}</b></header>{filtered.filter(t => t.day === d.date).map(t => <button key={t.id} onClick={() => setDrawer(t.owner)}><i /><b>{t.title}</b><small>{agents.find(a => a.id === t.owner)?.name}</small></button>)}</div>)}</div>
        </div>}

        {view === "approvals" && <div className="approvalDeck">
          {approvals.map(a => <section className={`approvalCard deckPanel ${decisions[a.id] ? "decided" : ""}`} key={a.id}>
            <header><div><span>{a.id} · {a.owner}</span><h2>{a.title}</h2></div><b>{decisions[a.id] || a.due}</b></header>
            <div className="approvalBody"><div><span>Executive summary</span><p>{a.summary}</p></div><div><span>Risk and consequence</span><p>{a.risk}</p></div><div><span>Quality gate</span><p>{a.signed}</p></div></div>
            <footer>{decisions[a.id] ? <button className="textLink" onClick={() => setDecisions(prev => { const n = { ...prev }; delete n[a.id]; return n; })}>Reset decision</button> : <><button className="liveBtn" onClick={() => setDecisions(p => ({ ...p, [a.id]: "Approved" }))}>Approve</button><button className="outlineBtn" onClick={() => setDecisions(p => ({ ...p, [a.id]: "Changes requested" }))}>Request changes</button><button className="ghostBtn" onClick={() => setDecisions(p => ({ ...p, [a.id]: "Declined" }))}>Decline</button></>}</footer>
          </section>)}
        </div>}
      </div>
    </main>

    {drawer && <div className="drawerShade" onMouseDown={() => setDrawer(null)}><aside className="deckDrawer" onMouseDown={e => e.stopPropagation()}><button className="drawerClose" onClick={() => setDrawer(null)}>Close</button>
      {drawer === "new" && <form onSubmit={e => { e.preventDefault(); addTask(new FormData(e.currentTarget)); }}><span className="liveLabel">New instruction</span><h2>One outcome, one owner.</h2><p>It lands in the agent’s inbox and waits for acknowledgement.</p><label>Instruction<input name="title" autoFocus required placeholder="What needs to happen?" /></label><label>Context<textarea name="context" placeholder="Background, constraints, links, and expected output." /></label><label>Definition of done<textarea name="dod" placeholder="What proves the work is complete?" /></label><div className="formPair"><label>Agent<select name="agent">{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>Priority<select name="priority"><option>High</option><option>Medium</option><option>Low</option></select></label></div><label>Project<input name="project" defaultValue="Herzen Co." /></label><label className="signoff"><input type="checkbox" name="signoff" /> Require K2 sign-off</label><button className="liveBtn full">Send instruction</button></form>}
      {drawer === "brief" && <div><span className="liveLabel">Daily brief · 30 July</span><h2>What moved, what stalled, what needs you.</h2><p>Compiled by Lupe at 10:20 from four agent updates.</p>{[["Completed", "Four meaningful outcomes closed across product, content, and operations."], ["Moved forward", "Skydeo rehearsals passed. August calendar is locked and signed."], ["Blocked", "One content brief waits on K2’s keyword pass."], ["Needs you", "Three approval packages are decision-ready."], ["Not reported", "Rex has not submitted today’s update."], ["Next", "Approve the calendar, resolve the API rate limit, then close the weekly brief."]].map(([l, t]) => <div className="briefLine" key={l}><span>{l}</span><p>{t}</p></div>)}<div className="briefRecommendation"><span>Lupe recommends</span><p>Approve the August calendar this morning. Hold Rex’s budget increase until test 04 closes Friday.</p></div></div>}
      {activeAgent && <div><div className="agentDrawerHead"><AgentMark id={activeAgent.id} large /><div><span className="liveLabel">{activeAgent.role}</span><h2>{activeAgent.name}</h2></div></div><p>{activeAgent.charter}</p><div className="agentStats"><div><b>{tasks.filter(t => t.owner === activeAgent.id && t.status !== "Done").length}</b><span>Open</span></div><div><b>{tasks.filter(t => t.owner === activeAgent.id && t.status === "Review").length}</b><span>In review</span></div><div><b>{tasks.filter(t => t.owner === activeAgent.id && t.status === "Done").length}</b><span>Closed</span></div></div><h3>Current instructions</h3>{tasks.filter(t => t.owner === activeAgent.id && t.status !== "Done").map(t => <button className="drawerTask" key={t.id} onClick={() => advance(t.id)}><span>{t.status}</span><b>{t.title}</b><small>{t.project} · {t.due}</small></button>)}<h3>Today’s update</h3>{[["Completed", activeAgent.id === "rex" ? "Not submitted." : "Priority work documented and packaged."], ["Moved forward", activeAgent.focus], ["Blocked", activeAgent.id === "c3po" ? "Waiting on calendar approval." : "Nothing blocked."], ["Next", "Advance the highest-consequence open instruction."]].map(([l, t]) => <div className="briefLine" key={l}><span>{l}</span><p>{t}</p></div>)}<button className="liveBtn full" onClick={() => setDrawer("new")}>Send instruction</button></div>}
    </aside></div>}
  </div>;
}
