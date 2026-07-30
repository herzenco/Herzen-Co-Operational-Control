"use client";

import { useMemo, useState } from "react";

type AgentId = "lupe" | "d8a" | "c3po" | "k2" | "rex";
type Status = "Inbox" | "In progress" | "Review" | "Done";
type View = "List" | "Board" | "Calendar";

type Agent = {
  id: AgentId;
  name: string;
  role: string;
  code: string;
  color: string;
  tint: string;
  status: string;
};

type Task = {
  id: number;
  title: string;
  project: string;
  status: Status;
  priority: "High" | "Medium" | "Low";
  agent: AgentId;
  due: string;
  day: number;
  note?: string;
};

const agents: Agent[] = [
  { id: "lupe", name: "Lupe", role: "Main operator", code: "LU", color: "#bda27a", tint: "#f4ede2", status: "Coordinating today’s run" },
  { id: "d8a", name: "D8-A", role: "Skydeo · product + technical ops", code: "D8", color: "#2d6b61", tint: "#e4efec", status: "2 priorities in progress" },
  { id: "c3po", name: "C-3PO", role: "Social media + content calendar", code: "C3", color: "#b46b39", tint: "#f6e9df", status: "Calendar updated 18m ago" },
  { id: "k2", name: "K2", role: "Research + optimization", code: "K2", color: "#5c6690", tint: "#e9eaf2", status: "1 package awaiting sign-off" },
  { id: "rex", name: "Rex", role: "Paid media specialist", code: "RX", color: "#994c4c", tint: "#f3e5e5", status: "Campaign review at 2:00 PM" },
];

const initialTasks: Task[] = [
  { id: 1, title: "Finalize Q3 operating roadmap", project: "Herzen Co.", status: "In progress", priority: "High", agent: "lupe", due: "Today", day: 30, note: "Consolidate lanes and flag dependencies." },
  { id: 2, title: "Map Skydeo onboarding v2", project: "Skydeo", status: "In progress", priority: "High", agent: "d8a", due: "Today", day: 30 },
  { id: 3, title: "Approve August content calendar", project: "Content", status: "Review", priority: "High", agent: "c3po", due: "Today", day: 30 },
  { id: 4, title: "Competitor hook research", project: "Growth", status: "Review", priority: "Medium", agent: "k2", due: "Tomorrow", day: 31 },
  { id: 5, title: "Refresh prospecting creative tests", project: "Paid media", status: "Inbox", priority: "Medium", agent: "rex", due: "Aug 1", day: 1 },
  { id: 6, title: "Document release checklist", project: "Skydeo", status: "Done", priority: "Low", agent: "d8a", due: "Jul 28", day: 28 },
  { id: 7, title: "Package weekly performance brief", project: "Growth", status: "Inbox", priority: "Medium", agent: "k2", due: "Aug 3", day: 3 },
  { id: 8, title: "Schedule founder story sequence", project: "Content", status: "In progress", priority: "Medium", agent: "c3po", due: "Aug 2", day: 2 },
  { id: 9, title: "Audit campaign naming system", project: "Paid media", status: "Done", priority: "Low", agent: "rex", due: "Jul 29", day: 29 },
];

const statusOrder: Status[] = ["Inbox", "In progress", "Review", "Done"];
const calendarDays = [
  { label: "MON", date: 27 }, { label: "TUE", date: 28 }, { label: "WED", date: 29 },
  { label: "THU", date: 30 }, { label: "FRI", date: 31 }, { label: "SAT", date: 1 }, { label: "SUN", date: 2 },
  { label: "", date: 3 }, { label: "", date: 4 }, { label: "", date: 5 },
  { label: "", date: 6 }, { label: "", date: 7 }, { label: "", date: 8 }, { label: "", date: 9 },
];

function Avatar({ agent, small = false }: { agent: Agent; small?: boolean }) {
  return <span className={`avatar ${small ? "avatarSmall" : ""}`} style={{ background: agent.tint, color: agent.color }}>{agent.code}</span>;
}

export function CommandCenter() {
  const [view, setView] = useState<View>("List");
  const [tasks, setTasks] = useState(initialTasks);
  const [selectedAgent, setSelectedAgent] = useState<AgentId | "all">("all");
  const [search, setSearch] = useState("");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [spaceOpen, setSpaceOpen] = useState<AgentId | null>(null);

  const filtered = useMemo(() => tasks.filter(task => {
    const matchesAgent = selectedAgent === "all" || task.agent === selectedAgent;
    const q = search.toLowerCase();
    return matchesAgent && (!q || `${task.title} ${task.project}`.toLowerCase().includes(q));
  }), [tasks, selectedAgent, search]);

  const activeAgent = spaceOpen ? agents.find(a => a.id === spaceOpen) : null;
  const completed = tasks.filter(t => t.status === "Done").length;
  const updateTask = (id: number, status: Status) => setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));

  function addTask(form: FormData) {
    const agent = (form.get("agent") as AgentId) || "lupe";
    const title = String(form.get("title") || "").trim();
    if (!title) return;
    setTasks(prev => [{
      id: Date.now(), title, project: String(form.get("project") || "Herzen Co."),
      status: "Inbox", priority: form.get("priority") as Task["priority"],
      agent, due: "Today", day: 30, note: String(form.get("instructions") || ""),
    }, ...prev]);
    setNewTaskOpen(false);
  }

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">H</div>
          <div><b>HERZEN CO.</b><span>OPERATIONS</span></div>
        </div>

        <nav className="nav">
          <button className="navItem active"><span>⌘</span> Command center</button>
          <button className="navItem" onClick={() => setView("List")}><span>☷</span> All work <em>{tasks.length}</em></button>
          <button className="navItem" onClick={() => setBriefOpen(true)}><span>◫</span> Daily brief</button>
          <button className="navItem"><span>⌁</span> Approval queue <em>2</em></button>
        </nav>

        <div className="sideLabel">AGENT SPACES <button aria-label="Add agent">＋</button></div>
        <div className="agentNav">
          {agents.map(agent => (
            <button key={agent.id} className={selectedAgent === agent.id ? "selected" : ""} onClick={() => { setSelectedAgent(agent.id); setSpaceOpen(agent.id); }}>
              <Avatar agent={agent} small />
              <span><b>{agent.name}</b><small>{agent.role.split("·")[0]}</small></span>
              <i className="presence" />
            </button>
          ))}
        </div>
        <div className="sideBottom">
          <button className="helpButton">?</button>
          <div className="userAvatar">TV</div>
          <div><b>Tito Valenzuela</b><span>Administrator</span></div>
          <button className="more">•••</button>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="mobileBrand">H</div>
          <label className="search"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search work, agents, projects..." /><kbd>⌘ K</kbd></label>
          <div className="topActions"><button className="iconButton">◔</button><button className="iconButton notification">♢<i /></button><button className="avatar user">TV</button></div>
        </header>

        <section className="content">
          <div className="eyebrow">THURSDAY, JULY 30</div>
          <div className="headingRow">
            <div><h1>Good morning, Tito.</h1><p>Here’s what your agents are moving forward today.</p></div>
            <div className="headingActions"><button className="secondary" onClick={() => setBriefOpen(true)}>◫ Daily update</button><button className="primary" onClick={() => setNewTaskOpen(true)}>＋ New instruction</button></div>
          </div>

          <div className="summaryGrid">
            <button className="summaryCard" onClick={() => setSelectedAgent("all")}><span className="metricIcon sand">↗</span><div><small>ACTIVE WORK</small><strong>{tasks.filter(t => t.status === "In progress").length}</strong><p><b>+2</b> since yesterday</p></div></button>
            <button className="summaryCard" onClick={() => setSelectedAgent("all")}><span className="metricIcon lilac">⌁</span><div><small>AWAITING REVIEW</small><strong>{tasks.filter(t => t.status === "Review").length}</strong><p>Needs your attention</p></div></button>
            <button className="summaryCard"><span className="metricIcon green">✓</span><div><small>COMPLETED THIS WEEK</small><strong>{completed + 14}</strong><p><b>↑ 22%</b> vs last week</p></div></button>
            <button className="summaryCard" onClick={() => setBriefOpen(true)}><span className="metricIcon blue">◷</span><div><small>UPDATES RECEIVED</small><strong>4<span>/5</span></strong><p>Rex due by 5:00 PM</p></div></button>
          </div>

          <div className="agentStripHeader"><div><h2>Your team</h2><span>5 agents online</span></div><button onClick={() => setSelectedAgent("all")}>View all agents →</button></div>
          <div className="agentStrip">
            {agents.map(agent => {
              const agentTasks = tasks.filter(t => t.agent === agent.id && t.status !== "Done").length;
              return <button className="agentCard" key={agent.id} onClick={() => setSpaceOpen(agent.id)}>
                <div className="agentCardTop"><Avatar agent={agent} /><span className="liveDot" /></div>
                <b>{agent.name}</b><small>{agent.role}</small>
                <div className="agentMeta"><span>{agent.status}</span><em>{agentTasks}</em></div>
              </button>;
            })}
          </div>

          <div className="workSection">
            <div className="workHeader">
              <div><h2>{selectedAgent === "all" ? "Work in motion" : `${agents.find(a => a.id === selectedAgent)?.name}’s work`}</h2><span>{filtered.filter(t => t.status !== "Done").length} active items across the team</span></div>
              <div className="workControls">
                <button className={`filterPill ${selectedAgent !== "all" ? "on" : ""}`} onClick={() => setSelectedAgent("all")}>⌑ {selectedAgent === "all" ? "Filter" : "Clear agent"} <b>{selectedAgent !== "all" ? 1 : ""}</b></button>
                <div className="viewSwitch">{(["List", "Board", "Calendar"] as View[]).map(v => <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>{v === "List" ? "☷" : v === "Board" ? "▦" : "□"} <span>{v}</span></button>)}</div>
              </div>
            </div>

            {view === "List" && <div className="listView">
              <div className="tableHead"><span>TASK</span><span>OWNER</span><span>STATUS</span><span>PRIORITY</span><span>DUE</span><span /></div>
              {filtered.map(task => { const agent = agents.find(a => a.id === task.agent)!; return (
                <div className="taskRow" key={task.id}>
                  <div className="taskTitle"><button onClick={() => updateTask(task.id, task.status === "Done" ? "Inbox" : "Done")} className={`check ${task.status === "Done" ? "checked" : ""}`}>{task.status === "Done" ? "✓" : ""}</button><span><b>{task.title}</b><small>{task.project}</small></span></div>
                  <div className="owner"><Avatar agent={agent} small /><span>{agent.name}</span></div>
                  <button className={`status status${task.status.replace(" ", "")}`} onClick={() => updateTask(task.id, statusOrder[(statusOrder.indexOf(task.status) + 1) % statusOrder.length])}><i />{task.status}</button>
                  <span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span>
                  <span className={task.due === "Today" ? "dueToday" : "due"}>{task.due}</span>
                  <button className="rowMore">•••</button>
                </div>
              ); })}
            </div>}

            {view === "Board" && <div className="boardView">
              {statusOrder.map(status => <div className="boardColumn" key={status}>
                <div className="columnHead"><span><i className={`columnDot ${status.replace(" ", "")}`} />{status}</span><b>{filtered.filter(t => t.status === status).length}</b><button>＋</button></div>
                {filtered.filter(t => t.status === status).map(task => { const agent = agents.find(a => a.id === task.agent)!; return <article className="boardCard" key={task.id}>
                  <span className="projectLabel">{task.project}</span><h3>{task.title}</h3>{task.note && <p>{task.note}</p>}
                  <div><Avatar agent={agent} small /><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span><small>{task.due}</small></div>
                  <button aria-label="Move task forward" onClick={() => updateTask(task.id, statusOrder[(statusOrder.indexOf(task.status) + 1) % statusOrder.length])}>→</button>
                </article>; })}
                <button className="addCard" onClick={() => setNewTaskOpen(true)}>＋ Add instruction</button>
              </div>)}
            </div>}

            {view === "Calendar" && <div className="calendarView">
              <div className="calendarTop"><button>‹</button><b>July — August 2026</b><button>›</button></div>
              <div className="calendarGrid">
                {calendarDays.map((day, i) => <div className={`calendarDay ${day.date === 30 ? "today" : ""}`} key={i}>
                  <header>{day.label && <span>{day.label}</span>}<b>{day.date}</b></header>
                  {filtered.filter(t => t.day === day.date).map(task => { const agent = agents.find(a => a.id === task.agent)!; return <button key={task.id} className="calendarTask" style={{ borderLeftColor: agent.color }} onClick={() => setSpaceOpen(agent.id)}><b>{task.title}</b><span><Avatar agent={agent} small />{agent.name}</span></button>; })}
                </div>)}
              </div>
            </div>}
          </div>
        </section>
      </main>

      {newTaskOpen && <div className="modalBackdrop" onMouseDown={() => setNewTaskOpen(false)}><form className="modal" onSubmit={e => { e.preventDefault(); addTask(new FormData(e.currentTarget)); }} onMouseDown={e => e.stopPropagation()}>
        <button type="button" className="modalClose" onClick={() => setNewTaskOpen(false)}>×</button><span className="modalEyebrow">NEW INSTRUCTION</span><h2>Put work in motion.</h2><p>Give an agent the context, outcome, and timing they need.</p>
        <label>Instruction<input name="title" autoFocus placeholder="What needs to happen?" required /></label>
        <label>Context & definition of done<textarea name="instructions" placeholder="Add the details, links, constraints, or expected output..." /></label>
        <div className="formGrid"><label>Assign to<select name="agent">{agents.map(a => <option key={a.id} value={a.id}>{a.name} — {a.role}</option>)}</select></label><label>Priority<select name="priority"><option>High</option><option>Medium</option><option>Low</option></select></label></div>
        <label>Project<input name="project" defaultValue="Herzen Co." /></label>
        <div className="modalActions"><button type="button" className="secondary" onClick={() => setNewTaskOpen(false)}>Cancel</button><button className="primary">Send instruction →</button></div>
      </form></div>}

      {briefOpen && <div className="drawerBackdrop" onMouseDown={() => setBriefOpen(false)}><aside className="drawer" onMouseDown={e => e.stopPropagation()}>
        <button className="modalClose" onClick={() => setBriefOpen(false)}>×</button><span className="modalEyebrow">DAILY BRIEF · JUL 30</span><h2>Today’s signal.</h2><p className="drawerIntro">A concise readout from every operating lane.</p>
        <div className="briefStats"><span><b>9</b> moved</span><span><b>2</b> blocked</span><span><b>4/5</b> reported</span></div>
        {agents.map((agent, i) => <div className="briefItem" key={agent.id}><Avatar agent={agent} /><div><header><b>{agent.name}</b><span>{i === 4 ? "Pending" : "Received"}</span></header><p>{i === 0 ? "Aligned the week’s priorities and cleared two cross-lane dependencies." : i === 1 ? "Completed the onboarding map; release checklist is documented and ready." : i === 2 ? "August calendar packaged for review. Founder story sequence is scheduled." : i === 3 ? "Hook research complete. One approval package is ready for final review." : "Update due by 5:00 PM. Campaign review is scheduled for 2:00 PM."}</p></div></div>)}
        <button className="primary full">Open full daily brief →</button>
      </aside></div>}

      {activeAgent && <div className="drawerBackdrop" onMouseDown={() => setSpaceOpen(null)}><aside className="drawer agentDrawer" onMouseDown={e => e.stopPropagation()}>
        <button className="modalClose" onClick={() => setSpaceOpen(null)}>×</button><div className="agentHero"><Avatar agent={activeAgent} /><span className="liveDot" /></div><span className="modalEyebrow">AGENT SPACE</span><h2>{activeAgent.name}</h2><p className="drawerIntro">{activeAgent.role}</p>
        <div className="spaceNav"><button className="active">Overview</button><button>Instructions</button><button>Work log</button><button>Updates</button></div>
        <section className="focusCard"><small>CURRENT FOCUS</small><h3>{tasks.find(t => t.agent === activeAgent.id && t.status === "In progress")?.title || "Ready for new instruction"}</h3><p>{activeAgent.status}</p><div className="progress"><i style={{ width: activeAgent.id === "lupe" ? "72%" : "58%" }} /></div></section>
        <h3 className="sectionTitle">Open work</h3>
        {tasks.filter(t => t.agent === activeAgent.id && t.status !== "Done").map(t => <button className="spaceTask" key={t.id}><span className={`priority ${t.priority.toLowerCase()}`}>{t.priority}</span><b>{t.title}</b><small>{t.status} · {t.due}</small></button>)}
        <button className="primary full" onClick={() => { setSpaceOpen(null); setNewTaskOpen(true); }}>＋ Send {activeAgent.name} an instruction</button>
      </aside></div>}
    </div>
  );
}
