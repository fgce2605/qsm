import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LayoutDashboard, Package, Truck, ArrowUpFromLine, ClipboardList,
  History, Tags, Sun, Moon, Plus, X, Search, Trash2, Pencil,
  AlertTriangle, CheckCircle2, TrendingDown, ShieldAlert, UserCog,
} from "lucide-react";
import { supabase } from "./supabaseClient";

// ---------- Theme tokens ----------
const THEMES = {
  light: {
    bg: "#F7F9F8", surface: "#FFFFFF", surfaceAlt: "#EFF4F2",
    border: "#DCE6E2", text: "#1C2624", textMuted: "#5B6E68",
    primary: "#0F766E", primarySoft: "#D9EFEA", accent: "#C2703D", onPrimary: "#FFFFFF",
    ok: "#16A34A", okSoft: "#DCFCE7", warn: "#D97706", warnSoft: "#FEF3C7",
    danger: "#DC2626", dangerSoft: "#FEE2E2",
  },
  dark: {
    bg: "#0E1614", surface: "#16211E", surfaceAlt: "#1C2926",
    border: "#26332F", text: "#E8EEEC", textMuted: "#8FA39D",
    primary: "#2DD4BF", primarySoft: "#123B36", accent: "#F0A868", onPrimary: "#0E1614",
    ok: "#4ADE80", okSoft: "#123B22", warn: "#FBBF24", warnSoft: "#3B2E0C",
    danger: "#F87171", dangerSoft: "#3B1414",
  },
};

const UNIT_BY_CATEGORY = {
  Glassware: "pcs", Chemical: "kg", Stationery: "pcs",
};
const DEFAULT_CATEGORIES = ["Glassware", "Chemical", "Stationery"];

const uid = () => Math.random().toString(36).slice(2, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-");
const fmtMoney = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

// ---------- Seed data ----------
const seedItems = () => [
  { id: uid(), name: "Acetone (AR Grade)", category: "Chemical", unit: "L", currentStock: 8, minStock: 10, reorderStock: 25, batch: "AC-2026-04", expiry: "2027-03-01", critical: true, manufacturer: "Merck" },
  { id: uid(), name: "Volumetric Flask 250ml", category: "Glassware", unit: "pcs", currentStock: 14, minStock: 6, reorderStock: 12, batch: "-", expiry: "", critical: false, manufacturer: "Borosil" },
  { id: uid(), name: "Karl Fischer Reagent", category: "Chemical", unit: "L", currentStock: 2, minStock: 4, reorderStock: 8, batch: "KF-1180", expiry: "2026-12-15", critical: true, manufacturer: "Sigma-Aldrich" },
  { id: uid(), name: "A4 Log Sheets", category: "Stationery", unit: "pcs", currentStock: 120, minStock: 50, reorderStock: 200, batch: "-", expiry: "", critical: false, manufacturer: "Local" },
];

// Cloud-backed storage: reads/writes a JSON blob under `key` in the Supabase
// `kv_store` table, and subscribes to realtime changes so every open device/tab
// updates automatically when another device saves.
function useStorage(key, initial) {
  const [value, setValue] = useState(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase.from("kv_store").select("value").eq("key", key).maybeSingle();
        if (!cancelled) {
          if (!error && data) setValue(data.value);
          setLoaded(true);
        }
      } catch (e) {
        console.error("supabase read failed", e);
        if (!cancelled) setLoaded(true);
      }
    })();

    const channel = supabase
      .channel("kv-" + key)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "kv_store", filter: `key=eq.${key}` },
        (payload) => {
          if (payload.new && payload.new.value !== undefined) setValue(payload.new.value);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [key]);

  const persist = useCallback(
    async (next) => {
      setValue(next);
      try {
        await supabase.from("kv_store").upsert({ key, value: next, updated_at: new Date().toISOString() });
      } catch (e) {
        console.error("supabase write failed", e);
      }
    },
    [key]
  );

  return [value, persist, loaded];
}

export default function App() {
  const [mode, setMode] = useState("dark");
  const t = THEMES[mode];
  const [role, setRole] = useState("admin"); // 'admin' | 'technician'
  const [tab, setTab] = useState("dashboard");
  const [search, setSearch] = useState("");

  const [items, setItems, itemsLoaded] = useStorage("qc-items", null);
  const [categories, setCategories, catLoaded] = useStorage("qc-categories", null);
  const [receipts, setReceipts, recLoaded] = useStorage("qc-receipts", null);
  const [issues, setIssues, issLoaded] = useStorage("qc-issues", null);
  const [indents, setIndents, indLoaded] = useStorage("qc-indents", null);

  const ready = itemsLoaded && catLoaded && recLoaded && issLoaded && indLoaded;

  useEffect(() => {
    if (!ready) return;
    if (items === null) setItems(seedItems());
    if (categories === null) setCategories(DEFAULT_CATEGORIES);
    if (receipts === null) setReceipts([]);
    if (issues === null) setIssues([]);
    if (indents === null) setIndents([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const safeItems = items || [];
  const safeReceipts = receipts || [];
  const safeIssues = issues || [];
  const safeIndents = indents || [];
  const safeCategories = categories || DEFAULT_CATEGORIES;

  // ---- Derived: reconcile indents whenever stock changes ----
  useEffect(() => {
    if (!ready || items === null || indents === null) return;
    let changed = false;
    let next = [...safeIndents];
    safeItems.forEach((it) => {
      const active = next.find((x) => x.itemId === it.id && x.status !== "Received" && x.status !== "Cancelled");
      if (it.currentStock < it.minStock) {
        if (!active) {
          next.push({ id: uid(), itemId: it.id, status: "Low Stock", createdDate: todayStr(), updatedDate: todayStr() });
          changed = true;
        }
      } else if (active) {
        next = next.map((x) => x.id === active.id ? { ...x, status: "Received", updatedDate: todayStr() } : x);
        changed = true;
      }
    });
    if (changed) setIndents(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, ready]);

  const statusOf = (it) => {
    if (it.currentStock < it.minStock) return "danger";
    if (it.currentStock < it.minStock * 1.25) return "warn";
    return "ok";
  };

  const counts = useMemo(() => {
    const low = safeItems.filter((i) => statusOf(i) === "danger").length;
    const near = safeItems.filter((i) => statusOf(i) === "warn").length;
    const activeIndents = safeIndents.filter((x) => x.status !== "Received" && x.status !== "Cancelled").length;
    const totalValue = safeItems.reduce((sum, it) => {
      const itReceipts = safeReceipts.filter((r) => r.itemId === it.id);
      const lastPrice = itReceipts.length ? itReceipts[itReceipts.length - 1].unitPrice : 0;
      return sum + lastPrice * it.currentStock;
    }, 0);
    return { total: safeItems.length, low, near, activeIndents, totalValue };
  }, [safeItems, safeIndents, safeReceipts]);

  const recentActivity = useMemo(() => {
    const rec = safeReceipts.map((r) => ({ type: "in", date: r.date, id: r.id, itemId: r.itemId, qty: r.qty }));
    const iss = safeIssues.map((r) => ({ type: "out", date: r.date, id: r.id, itemId: r.itemId, qty: r.qty }));
    return [...rec, ...iss].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
  }, [safeReceipts, safeIssues]);

  const itemName = (id) => safeItems.find((i) => i.id === id)?.name || "Unknown item";

  // ---- Mutations ----
  const addItem = (payload) => setItems([...safeItems, { id: uid(), ...payload }]);
  const updateItem = (id, patch) => setItems(safeItems.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const deleteItem = (id) => {
    setItems(safeItems.filter((i) => i.id !== id));
    setReceipts(safeReceipts.filter((r) => r.itemId !== id));
    setIssues(safeIssues.filter((r) => r.itemId !== id));
    setIndents(safeIndents.filter((r) => r.itemId !== id));
  };

  const addReceipt = (payload) => {
    const totalPrice = Number(payload.qty) * Number(payload.unitPrice);
    const receipt = { id: uid(), ...payload, totalPrice, qty: Number(payload.qty), unitPrice: Number(payload.unitPrice) };
    setReceipts([...safeReceipts, receipt]);
    const it = safeItems.find((i) => i.id === payload.itemId);
    if (it) updateItem(it.id, { currentStock: it.currentStock + receipt.qty });
  };

  const addIssue = (payload) => {
    const issue = { id: uid(), ...payload, qty: Number(payload.qty) };
    setIssues([...safeIssues, issue]);
    const it = safeItems.find((i) => i.id === payload.itemId);
    if (it) updateItem(it.id, { currentStock: Math.max(0, it.currentStock - issue.qty) });
  };

  const advanceIndent = (id, status) => setIndents(safeIndents.map((x) => (x.id === id ? { ...x, status, updatedDate: todayStr() } : x)));

  const addCategory = (name) => {
    if (name && !safeCategories.includes(name)) setCategories([...safeCategories, name]);
  };

  // ---- Quick spreadsheet-style row entry: creates/matches item, logs receipt, optional issue, all in one commit ----
  const commitQuickRow = (row) => {
    const cleanName = (row.description || "").trim();
    if (!cleanName || !row.qty || !row.rate || !row.receiveDate) return false;
    let itemsNext = [...safeItems];
    let existing = itemsNext.find((i) => i.name.trim().toLowerCase() === cleanName.toLowerCase());
    let itemId;
    if (existing) {
      itemId = existing.id;
    } else {
      const newItem = {
        id: uid(), name: cleanName, category: row.category || safeCategories[0],
        unit: row.unit || UNIT_BY_CATEGORY[row.category] || "pcs",
        currentStock: 0, minStock: 0, reorderStock: 0, batch: "", expiry: "",
        critical: false, manufacturer: row.mfr || "", packSize: row.packSize || "",
      };
      itemsNext.push(newItem);
      existing = newItem;
      itemId = newItem.id;
    }
    const qty = Number(row.qty);
    const rate = Number(row.rate);
    const issueQty = Number(row.issueQty || 0);
    const newStock = existing.currentStock + qty - issueQty;
    itemsNext = itemsNext.map((i) => (i.id === itemId ? { ...i, currentStock: newStock, manufacturer: row.mfr || i.manufacturer, packSize: row.packSize || i.packSize } : i));

    const receipt = {
      id: uid(), itemId, date: row.receiveDate, manufacturer: row.mfr || "", invoiceNo: row.invoiceNo || "",
      packSize: row.packSize || "", qty, unitPrice: rate, totalPrice: qty * rate,
    };
    let receiptsNext = [...safeReceipts, receipt];
    let issuesNext = safeIssues;
    if (issueQty > 0) {
      issuesNext = [...safeIssues, { id: uid(), itemId, date: row.issueDate || todayStr(), qty: issueQty, issuedTo: "Quick entry" }];
    }
    setItems(itemsNext);
    setReceipts(receiptsNext);
    if (issueQty > 0) setIssues(issuesNext);
    return { itemId, stockAfter: newStock };
  };

  const filteredItems = safeItems.filter((i) =>
    !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.category.toLowerCase().includes(search.toLowerCase())
  );

  const NAV = [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "inventory", label: "Inventory", icon: Package },
    { key: "receiving", label: "Receiving", icon: Truck },
    { key: "issue", label: "Issue", icon: ArrowUpFromLine },
    { key: "indent", label: "Indent", icon: ClipboardList, badge: counts.activeIndents },
    { key: "transactions", label: "Transactions", icon: History },
    { key: "categories", label: "Categories", icon: Tags },
  ];

  if (!ready) {
    return (
      <div style={{ background: t.bg, color: t.text, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif" }}>
        Loading QC Stock Manager…
      </div>
    );
  }

  return (
    <div style={{ background: t.bg, color: t.text, minHeight: "100vh", fontFamily: "'Inter', sans-serif", transition: "background .25s, color .25s" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        .sg { font-family: 'Space Grotesk', sans-serif; }
        .tab-btn { transition: background .15s, color .15s; }
        table { border-collapse: collapse; width: 100%; }
        input, select { font-family: 'Inter', sans-serif; }
        ::-webkit-scrollbar { height: 8px; width: 8px; }
        .pulse { animation: pulse 1.8s infinite; }
        @keyframes pulse { 0%,100%{ opacity:1 } 50%{ opacity:.4 } }
      `}</style>

      <TopBar t={t} mode={mode} setMode={setMode} role={role} setRole={setRole} search={search} setSearch={setSearch} />

      <div style={{ display: "flex", maxWidth: 1280, margin: "0 auto" }}>
        <nav style={{ width: 210, flexShrink: 0, padding: "20px 12px", borderRight: `1px solid ${t.border}`, minHeight: "calc(100vh - 64px)" }}>
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => setTab(n.key)}
              className="tab-btn"
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "10px 12px", marginBottom: 4, borderRadius: 10, border: "none",
                cursor: "pointer", fontSize: 14, fontWeight: 600, textAlign: "left",
                background: tab === n.key ? t.primarySoft : "transparent",
                color: tab === n.key ? t.primary : t.textMuted,
              }}
            >
              <n.icon size={17} />
              {n.label}
              {!!n.badge && (
                <span style={{ marginLeft: "auto", background: t.danger, color: "#fff", fontSize: 11, borderRadius: 999, padding: "1px 7px", fontWeight: 700 }}>
                  {n.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        <main style={{ flex: 1, padding: "24px 28px" }}>
          {tab === "dashboard" && <Dashboard t={t} counts={counts} items={safeItems} categories={safeCategories} statusOf={statusOf} recentActivity={recentActivity} itemName={itemName} setTab={setTab} />}
          {tab === "inventory" && <Inventory t={t} role={role} items={filteredItems} categories={safeCategories} statusOf={statusOf} addItem={addItem} updateItem={updateItem} deleteItem={deleteItem} />}
          {tab === "receiving" && <Receiving t={t} items={safeItems} receipts={safeReceipts} addReceipt={addReceipt} itemName={itemName} categories={safeCategories} commitQuickRow={commitQuickRow} />}
          {tab === "issue" && <IssueTab t={t} items={safeItems} issues={safeIssues} addIssue={addIssue} itemName={itemName} />}
          {tab === "indent" && <IndentTab t={t} role={role} indents={safeIndents} items={safeItems} itemName={itemName} advanceIndent={advanceIndent} />}
          {tab === "transactions" && <Transactions t={t} receipts={safeReceipts} issues={safeIssues} itemName={itemName} />}
          {tab === "categories" && <Categories t={t} categories={safeCategories} addCategory={addCategory} items={safeItems} />}
        </main>
      </div>
    </div>
  );
}

// ---------- Top bar ----------
function TopBar({ t, mode, setMode, role, setRole, search, setSearch }) {
  return (
    <header style={{ borderBottom: `1px solid ${t.border}`, background: t.surface, position: "sticky", top: 0, zIndex: 10 }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 24px", height: 64, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: t.primary, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Package size={18} color={mode === "dark" ? "#0E1614" : "#fff"} />
          </div>
          <div className="sg" style={{ fontWeight: 700, fontSize: 17 }}>QC Stock Manager</div>
        </div>

        <div style={{ flex: 1, maxWidth: 360, marginLeft: 24, position: "relative" }}>
          <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: t.textMuted }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search item, category, invoice…"
            style={{
              width: "100%", padding: "8px 10px 8px 32px", borderRadius: 8,
              border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 13, outline: "none",
            }}
          />
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => setRole(role === "admin" ? "technician" : "admin")}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.surfaceAlt, color: t.text, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
            title="Toggle role"
          >
            <UserCog size={14} /> {role === "admin" ? "Admin" : "Technician"}
          </button>
          <button
            onClick={() => setMode(mode === "dark" ? "light" : "dark")}
            style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${t.border}`, background: t.surfaceAlt, color: t.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            title="Toggle theme"
          >
            {mode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>
    </header>
  );
}

// ---------- Shared bits ----------
function StatusDot({ t, status }) {
  const color = status === "danger" ? t.danger : status === "warn" ? t.warn : t.ok;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className={status === "danger" ? "pulse" : ""} style={{ width: 9, height: 9, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}` }} />
    </span>
  );
}

function Card({ t, children, style }) {
  return <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, ...style }}>{children}</div>;
}

function Th({ t, children }) {
  return <th style={{ textAlign: "left", fontSize: 11.5, letterSpacing: 0.4, textTransform: "uppercase", color: t.textMuted, padding: "8px 10px", borderBottom: `1px solid ${t.border}`, fontWeight: 700 }}>{children}</th>;
}
function Td({ t, children, style }) {
  return <td style={{ padding: "10px 10px", borderBottom: `1px solid ${t.border}`, fontSize: 13.5, ...style }}>{children}</td>;
}

function PrimaryBtn({ t, onClick, children, type = "button" }) {
  return (
    <button type={type} onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 6, background: t.primary, color: t.onPrimary, border: "none", borderRadius: 9, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
      {children}
    </button>
  );
}

function Input({ t, ...props }) {
  return <input {...props} style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 13, width: "100%", ...(props.style || {}) }} />;
}
function Select({ t, children, ...props }) {
  return <select {...props} style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 13, width: "100%" }}>{children}</select>;
}
function Label({ t, children }) {
  return <label style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, display: "block", marginBottom: 4 }}>{children}</label>;
}

// ---------- Dashboard ----------
function Dashboard({ t, counts, items, categories, statusOf, recentActivity, itemName, setTab }) {
  const catBreakdown = categories.map((c) => ({ c, n: items.filter((i) => i.category === c).length }));
  const stats = [
    { label: "Total Items", value: counts.total, icon: Package, color: t.primary },
    { label: "Below Min Stock", value: counts.low, icon: TrendingDown, color: t.danger },
    { label: "Near Min Stock", value: counts.near, icon: AlertTriangle, color: t.warn },
    { label: "Active Indents", value: counts.activeIndents, icon: ClipboardList, color: t.accent },
  ];
  return (
    <div>
      <h1 className="sg" style={{ fontSize: 22, marginBottom: 2 }}>Dashboard</h1>
      <p style={{ color: t.textMuted, fontSize: 13.5, marginBottom: 20 }}>Central overview — every tab stays in sync with this data.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        {stats.map((s) => (
          <Card key={s.label} t={t}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ color: t.textMuted, fontSize: 12, fontWeight: 600 }}>{s.label}</div>
                <div className="sg" style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{s.value}</div>
              </div>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: s.color + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <s.icon size={17} color={s.color} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14 }}>
        <Card t={t}>
          <div className="sg" style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Stock Status by Item</div>
          <table>
            <thead><tr><Th t={t}>Item</Th><Th t={t}>Category</Th><Th t={t}>Stock</Th><Th t={t}>Min</Th><Th t={t}>Status</Th></tr></thead>
            <tbody>
              {items.slice(0, 8).map((i) => (
                <tr key={i.id}>
                  <Td t={t}>{i.name}</Td>
                  <Td t={t} style={{ color: t.textMuted }}>{i.category}</Td>
                  <Td t={t}>{i.currentStock} {i.unit}</Td>
                  <Td t={t} style={{ color: t.textMuted }}>{i.minStock} {i.unit}</Td>
                  <Td t={t}><StatusDot t={t} status={statusOf(i)} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => setTab("inventory")} style={{ marginTop: 10, background: "none", border: "none", color: t.primary, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>View full inventory →</button>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card t={t}>
            <div className="sg" style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Category Breakdown</div>
            {catBreakdown.map((c) => (
              <div key={c.c} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                  <span>{c.c}</span><span style={{ color: t.textMuted }}>{c.n}</span>
                </div>
                <div style={{ height: 6, borderRadius: 4, background: t.surfaceAlt }}>
                  <div style={{ height: 6, borderRadius: 4, background: t.primary, width: `${counts.total ? (c.n / counts.total) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </Card>

          <Card t={t}>
            <div className="sg" style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Recent Activity</div>
            {recentActivity.length === 0 && <div style={{ color: t.textMuted, fontSize: 12.5 }}>No activity yet.</div>}
            {recentActivity.map((a) => (
              <div key={a.type + a.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "6px 0", borderBottom: `1px solid ${t.border}` }}>
                <span>{a.type === "in" ? "📥" : "📤"} {itemName(a.itemId)}</span>
                <span style={{ color: t.textMuted }}>{a.qty} · {fmtDate(a.date)}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------- Inventory ----------
function Inventory({ t, role, items, categories, statusOf, addItem, updateItem, deleteItem }) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const blank = { name: "", category: categories[0], unit: UNIT_BY_CATEGORY[categories[0]] || "pcs", currentStock: 0, minStock: 0, reorderStock: 0, batch: "", expiry: "", critical: false, manufacturer: "" };
  const [form, setForm] = useState(blank);

  const openNew = () => { setForm(blank); setEditId(null); setShowForm(true); };
  const openEdit = (it) => { setForm(it); setEditId(it.id); setShowForm(true); };

  const submit = (e) => {
    e.preventDefault();
    if (!form.name) return;
    const payload = { ...form, currentStock: Number(form.currentStock), minStock: Number(form.minStock), reorderStock: Number(form.reorderStock) };
    if (editId) updateItem(editId, payload); else addItem(payload);
    setShowForm(false);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 className="sg" style={{ fontSize: 22 }}>Inventory</h1>
          <p style={{ color: t.textMuted, fontSize: 13.5 }}>{items.length} items across {categories.length} categories</p>
        </div>
        {role === "admin" && <PrimaryBtn t={t} onClick={openNew}><Plus size={15} /> Add Item</PrimaryBtn>}
      </div>

      <Card t={t} style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead><tr>
            <Th t={t}>Item</Th><Th t={t}>Category</Th><Th t={t}>Stock</Th><Th t={t}>Min / Reorder</Th>
            <Th t={t}>Batch</Th><Th t={t}>Expiry</Th><Th t={t}>Status</Th><Th t={t}></Th>
          </tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <Td t={t}><div style={{ fontWeight: 600 }}>{i.name}</div>{i.critical && <span style={{ fontSize: 10.5, color: t.danger, display: "flex", alignItems: "center", gap: 3, marginTop: 2 }}><ShieldAlert size={11} /> Critical</span>}</Td>
                <Td t={t} style={{ color: t.textMuted }}>{i.category}</Td>
                <Td t={t}>{i.currentStock} {i.unit}</Td>
                <Td t={t} style={{ color: t.textMuted }}>{i.minStock} / {i.reorderStock} {i.unit}</Td>
                <Td t={t} style={{ color: t.textMuted }}>{i.batch || "-"}</Td>
                <Td t={t} style={{ color: t.textMuted }}>{i.expiry ? fmtDate(i.expiry) : "-"}</Td>
                <Td t={t}><StatusDot t={t} status={statusOf(i)} /></Td>
                <Td t={t}>
                  {role === "admin" && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => openEdit(i)} style={{ background: "none", border: "none", cursor: "pointer", color: t.textMuted }}><Pencil size={14} /></button>
                      <button onClick={() => deleteItem(i.id)} style={{ background: "none", border: "none", cursor: "pointer", color: t.danger }}><Trash2 size={14} /></button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showForm && (
        <Modal t={t} onClose={() => setShowForm(false)} title={editId ? "Edit Item" : "Add Item"}>
          <form onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ gridColumn: "span 2" }}><Label t={t}>Item Name</Label><Input t={t} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div><Label t={t}>Category</Label>
              <Select t={t} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value, unit: UNIT_BY_CATEGORY[e.target.value] || form.unit })}>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div><Label t={t}>Unit</Label><Input t={t} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
            <div><Label t={t}>Current Stock</Label><Input t={t} type="number" value={form.currentStock} onChange={(e) => setForm({ ...form, currentStock: e.target.value })} /></div>
            <div><Label t={t}>Min Stock</Label><Input t={t} type="number" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} /></div>
            <div><Label t={t}>Reorder Qty</Label><Input t={t} type="number" value={form.reorderStock} onChange={(e) => setForm({ ...form, reorderStock: e.target.value })} /></div>
            <div><Label t={t}>Manufacturer</Label><Input t={t} value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} /></div>
            <div><Label t={t}>Batch / Lot No.</Label><Input t={t} value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} /></div>
            <div><Label t={t}>Expiry Date</Label><Input t={t} type="date" value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })} /></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
              <input type="checkbox" checked={form.critical} onChange={(e) => setForm({ ...form, critical: e.target.checked })} id="crit" />
              <label htmlFor="crit" style={{ fontSize: 13 }}>Mark as critical item</label>
            </div>
            <div style={{ gridColumn: "span 2", marginTop: 8 }}><PrimaryBtn t={t} type="submit">{editId ? "Save Changes" : "Add Item"}</PrimaryBtn></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ---------- Quick spreadsheet-style entry grid ----------
function blankQuickRow() {
  return { id: uid(), description: "", category: "", mfr: "", packSize: "", qty: "", unit: "pcs", rate: "", invoiceNo: "", receiveDate: todayStr(), issueDate: "", issueQty: "", saved: false, stockAfter: null };
}
function QuickEntryGrid({ t, items, categories, commitQuickRow }) {
  const [rows, setRows] = useState([blankQuickRow()]);
  const updateRow = (id, patch) => setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const saveRow = (id) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const result = commitQuickRow(row);
    if (result) {
      setRows((prev) => {
        const next = prev.map((r) => (r.id === id ? { ...r, saved: true, stockAfter: result.stockAfter } : r));
        return [...next, blankQuickRow()];
      });
    }
  };
  const removeRow = (id) => setRows(rows.filter((r) => r.id !== id));

  const cellStyle = { padding: "5px 6px", borderBottom: `1px solid ${t.border}` };
  const smallInput = { padding: "6px 7px", borderRadius: 6, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 12.5, width: "100%" };

  return (
    <Card t={t} style={{ padding: 0, overflow: "auto", marginBottom: 20 }}>
      <div style={{ minWidth: 1180 }}>
        <table>
          <thead>
            <tr>
              {["S.No", "Description of Goods", "Category", "Mfr", "Pack Size", "Qty", "Unit", "Rate", "Invoice No.", "Amount", "Receive Date", "Issue Date", "Issue Qty", "In Stock", ""].map((h) => (
                <Th t={t} key={h}>{h}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const amount = (Number(r.qty) || 0) * (Number(r.rate) || 0);
              return (
                <tr key={r.id} style={{ background: r.saved ? t.surfaceAlt : "transparent" }}>
                  <td style={cellStyle}>{idx + 1}</td>
                  <td style={cellStyle}>
                    <input list="qc-item-names" style={smallInput} disabled={r.saved} value={r.description} onChange={(e) => updateRow(r.id, { description: e.target.value })} placeholder="Item name" />
                  </td>
                  <td style={cellStyle}>
                    <select style={smallInput} disabled={r.saved} value={r.category} onChange={(e) => updateRow(r.id, { category: e.target.value, unit: UNIT_BY_CATEGORY[e.target.value] || r.unit })}>
                      <option value="">Select</option>
                      {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td style={cellStyle}><input style={smallInput} disabled={r.saved} value={r.mfr} onChange={(e) => updateRow(r.id, { mfr: e.target.value })} /></td>
                  <td style={cellStyle}><input style={smallInput} disabled={r.saved} value={r.packSize} onChange={(e) => updateRow(r.id, { packSize: e.target.value })} placeholder="2.5 L" /></td>
                  <td style={cellStyle}><input type="number" style={smallInput} disabled={r.saved} value={r.qty} onChange={(e) => updateRow(r.id, { qty: e.target.value })} /></td>
                  <td style={cellStyle}><input style={smallInput} disabled={r.saved} value={r.unit} onChange={(e) => updateRow(r.id, { unit: e.target.value })} /></td>
                  <td style={cellStyle}><input type="number" style={smallInput} disabled={r.saved} value={r.rate} onChange={(e) => updateRow(r.id, { rate: e.target.value })} /></td>
                  <td style={cellStyle}><input style={smallInput} disabled={r.saved} value={r.invoiceNo} onChange={(e) => updateRow(r.id, { invoiceNo: e.target.value })} /></td>
                  <td style={{ ...cellStyle, fontWeight: 700 }}>{fmtMoney(amount)}</td>
                  <td style={cellStyle}><input type="date" style={smallInput} disabled={r.saved} value={r.receiveDate} onChange={(e) => updateRow(r.id, { receiveDate: e.target.value })} /></td>
                  <td style={cellStyle}><input type="date" style={smallInput} disabled={r.saved} value={r.issueDate} onChange={(e) => updateRow(r.id, { issueDate: e.target.value })} /></td>
                  <td style={cellStyle}><input type="number" style={smallInput} disabled={r.saved} value={r.issueQty} onChange={(e) => updateRow(r.id, { issueQty: e.target.value })} /></td>
                  <td style={{ ...cellStyle, fontWeight: 700 }}>{r.saved ? r.stockAfter : "-"}</td>
                  <td style={cellStyle}>
                    {!r.saved ? (
                      <button onClick={() => saveRow(r.id)} title="Save row" style={{ background: t.primary, color: t.onPrimary, border: "none", borderRadius: 6, width: 26, height: 26, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>✓</button>
                    ) : (
                      rows.length > 1 && idx !== rows.length - 1 ? null : null
                    )}
                    {!r.saved && rows.length > 1 && (
                      <button onClick={() => removeRow(r.id)} title="Remove row" style={{ background: "none", color: t.danger, border: "none", cursor: "pointer", marginLeft: 4 }}><Trash2 size={13} /></button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id="qc-item-names">
          {items.map((i) => <option key={i.id} value={i.name} />)}
        </datalist>
      </div>
      <div style={{ padding: "10px 12px", fontSize: 11.5, color: t.textMuted }}>
        Type a row like your sheet, hit ✓ to save — item, receiving entry, and (if Issue Qty filled) an issue entry are all created together and reflected on every tab instantly.
      </div>
    </Card>
  );
}

// ---------- Receiving ----------
function Receiving({ t, items, receipts, addReceipt, itemName, categories, commitQuickRow }) {
  const blank = { itemId: items[0]?.id || "", date: todayStr(), manufacturer: "", invoiceNo: "", qty: "", unitPrice: "" };
  const [form, setForm] = useState(blank);
  const [filterItem, setFilterItem] = useState("all");

  const submit = (e) => {
    e.preventDefault();
    if (!form.itemId || !form.qty || !form.unitPrice) return;
    addReceipt(form);
    setForm({ ...blank, itemId: form.itemId });
  };

  const visibleReceipts = receipts.filter((r) => filterItem === "all" || r.itemId === filterItem).sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div>
      <h1 className="sg" style={{ fontSize: 22, marginBottom: 2 }}>Stock Receiving (GRN)</h1>
      <p style={{ color: t.textMuted, fontSize: 13.5, marginBottom: 16 }}>Log every incoming batch — total price auto-calculates, stock updates instantly.</p>

      <div className="sg" style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Quick Entry (spreadsheet style)</div>
      <QuickEntryGrid t={t} items={items} categories={categories} commitQuickRow={commitQuickRow} />

      <div className="sg" style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Detailed Entry Form</div>
      <Card t={t} style={{ marginBottom: 20 }}>
        <form onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, alignItems: "end" }}>
          <div><Label t={t}>Item</Label><Select t={t} value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
          <div><Label t={t}>Date Received</Label><Input t={t} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div><Label t={t}>Manufacturer</Label><Input t={t} value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} /></div>
          <div><Label t={t}>Invoice No.</Label><Input t={t} value={form.invoiceNo} onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })} /></div>
          <div><Label t={t}>Qty</Label><Input t={t} type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} required /></div>
          <div><Label t={t}>Unit Price / pc</Label><Input t={t} type="number" step="0.01" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} required /></div>
          <div style={{ gridColumn: "span 6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, color: t.textMuted }}>Total Price: <b style={{ color: t.text }}>{fmtMoney((form.qty || 0) * (form.unitPrice || 0))}</b></div>
            <PrimaryBtn t={t} type="submit"><Plus size={15} /> Add Receipt Entry</PrimaryBtn>
          </div>
        </form>
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div className="sg" style={{ fontWeight: 700, fontSize: 14 }}>Receiving History (Multi-Receipt Log)</div>
        <div style={{ width: 220 }}><Select t={t} value={filterItem} onChange={(e) => setFilterItem(e.target.value)}><option value="all">All items</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
      </div>
      <Card t={t} style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead><tr><Th t={t}>Item</Th><Th t={t}>Pack Size</Th><Th t={t}>Date</Th><Th t={t}>Manufacturer</Th><Th t={t}>Invoice No.</Th><Th t={t}>Qty</Th><Th t={t}>Unit Price</Th><Th t={t}>Total Price</Th></tr></thead>
          <tbody>
            {visibleReceipts.map((r) => (
              <tr key={r.id}>
                <Td t={t}>{itemName(r.itemId)}</Td><Td t={t} style={{ color: t.textMuted }}>{r.packSize || "-"}</Td><Td t={t} style={{ color: t.textMuted }}>{fmtDate(r.date)}</Td>
                <Td t={t}>{r.manufacturer || "-"}</Td><Td t={t}>{r.invoiceNo || "-"}</Td>
                <Td t={t}>{r.qty}</Td><Td t={t}>{fmtMoney(r.unitPrice)}</Td><Td t={t} style={{ fontWeight: 700 }}>{fmtMoney(r.totalPrice)}</Td>
              </tr>
            ))}
            {visibleReceipts.length === 0 && <tr><Td t={t} style={{ color: t.textMuted }} colSpan={8}>No receiving entries yet.</Td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- Issue ----------
function IssueTab({ t, items, issues, addIssue, itemName }) {
  const blank = { itemId: items[0]?.id || "", date: todayStr(), qty: "", issuedTo: "" };
  const [form, setForm] = useState(blank);

  const submit = (e) => {
    e.preventDefault();
    if (!form.itemId || !form.qty) return;
    addIssue(form);
    setForm({ ...blank, itemId: form.itemId });
  };

  const sorted = [...issues].sort((a, b) => new Date(b.date) - new Date(a.date));
  const itemById = (id) => items.find((i) => i.id === id);

  return (
    <div>
      <h1 className="sg" style={{ fontSize: 22, marginBottom: 2 }}>Material Issue</h1>
      <p style={{ color: t.textMuted, fontSize: 13.5, marginBottom: 20 }}>Record material issued for testing — remaining qty and dashboard update automatically.</p>

      <Card t={t} style={{ marginBottom: 20 }}>
        <form onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, alignItems: "end" }}>
          <div><Label t={t}>Item</Label><Select t={t} value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}>{items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.currentStock} {i.unit} avail.)</option>)}</Select></div>
          <div><Label t={t}>Issue Date</Label><Input t={t} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div><Label t={t}>Qty Issued</Label><Input t={t} type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} required /></div>
          <div><Label t={t}>Issued To / Purpose</Label><Input t={t} value={form.issuedTo} onChange={(e) => setForm({ ...form, issuedTo: e.target.value })} placeholder="e.g. NCO% testing" /></div>
          <div style={{ gridColumn: "span 4" }}><PrimaryBtn t={t} type="submit"><Plus size={15} /> Record Issue</PrimaryBtn></div>
        </form>
      </Card>

      <div className="sg" style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Issue Log</div>
      <Card t={t} style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead><tr><Th t={t}>Item</Th><Th t={t}>Issue Date</Th><Th t={t}>Qty Issued</Th><Th t={t}>Issued To</Th><Th t={t}>Remaining Stock</Th></tr></thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id}>
                <Td t={t}>{itemName(r.itemId)}</Td><Td t={t} style={{ color: t.textMuted }}>{fmtDate(r.date)}</Td>
                <Td t={t}>{r.qty}</Td><Td t={t}>{r.issuedTo || "-"}</Td>
                <Td t={t} style={{ fontWeight: 700 }}>{itemById(r.itemId)?.currentStock ?? "-"} {itemById(r.itemId)?.unit}</Td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><Td t={t} style={{ color: t.textMuted }} colSpan={5}>No issue entries yet.</Td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- Indent ----------
const STAGES = ["Low Stock", "Indent Raised", "Ordered", "Received"];
function IndentTab({ t, role, indents, items, itemName, advanceIndent }) {
  const active = indents.filter((x) => x.status !== "Received" && x.status !== "Cancelled").sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));
  const history = indents.filter((x) => x.status === "Received").sort((a, b) => new Date(b.updatedDate) - new Date(a.updatedDate)).slice(0, 10);
  const itemById = (id) => items.find((i) => i.id === id);

  const exportCSV = () => {
    const rows = [["Item", "Category", "Current Stock", "Min Stock", "Status", "Raised On"]];
    active.forEach((x) => {
      const it = itemById(x.itemId);
      if (it) rows.push([it.name, it.category, it.currentStock, it.minStock, x.status, x.createdDate]);
    });
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "indent-list.csv"; a.click();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div><h1 className="sg" style={{ fontSize: 22 }}>Indent List</h1><p style={{ color: t.textMuted, fontSize: 13.5 }}>Auto-generated when stock falls below minimum.</p></div>
        <button onClick={exportCSV} style={{ padding: "8px 14px", borderRadius: 9, border: `1px solid ${t.border}`, background: t.surfaceAlt, color: t.text, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Export CSV</button>
      </div>

      <Card t={t} style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
        <table>
          <thead><tr><Th t={t}>Item</Th><Th t={t}>Category</Th><Th t={t}>Current / Min</Th><Th t={t}>Raised On</Th><Th t={t}>Stage</Th>{role === "admin" && <Th t={t}>Advance</Th>}</tr></thead>
          <tbody>
            {active.map((x) => {
              const it = itemById(x.itemId);
              if (!it) return null;
              return (
                <tr key={x.id}>
                  <Td t={t}><div style={{ fontWeight: 600 }}>{it.name}</div>{it.critical && <span style={{ fontSize: 10.5, color: t.danger }}>Critical item</span>}</Td>
                  <Td t={t} style={{ color: t.textMuted }}>{it.category}</Td>
                  <Td t={t}>{it.currentStock} / {it.minStock} {it.unit}</Td>
                  <Td t={t} style={{ color: t.textMuted }}>{fmtDate(x.createdDate)}</Td>
                  <Td t={t}><StageBadge t={t} stage={x.status} /></Td>
                  {role === "admin" && (
                    <Td t={t}>
                      {STAGES.indexOf(x.status) < STAGES.length - 1 && (
                        <button onClick={() => advanceIndent(x.id, STAGES[STAGES.indexOf(x.status) + 1])} style={{ fontSize: 11.5, fontWeight: 700, color: t.primary, background: "none", border: `1px solid ${t.primary}`, borderRadius: 7, padding: "4px 8px", cursor: "pointer" }}>
                          Mark {STAGES[STAGES.indexOf(x.status) + 1]}
                        </button>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
            {active.length === 0 && <tr><Td t={t} style={{ color: t.textMuted }} colSpan={6}><CheckCircle2 size={14} style={{ marginRight: 6, verticalAlign: -2 }} />All items above minimum stock. Nothing pending.</Td></tr>}
          </tbody>
        </table>
      </Card>

      <div className="sg" style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Recently Received (auto-cleared)</div>
      <Card t={t} style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead><tr><Th t={t}>Item</Th><Th t={t}>Cleared On</Th></tr></thead>
          <tbody>
            {history.map((x) => <tr key={x.id}><Td t={t}>{itemName(x.itemId)}</Td><Td t={t} style={{ color: t.textMuted }}>{fmtDate(x.updatedDate)}</Td></tr>)}
            {history.length === 0 && <tr><Td t={t} style={{ color: t.textMuted }} colSpan={2}>Nothing cleared yet.</Td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function StageBadge({ t, stage }) {
  const colorMap = { "Low Stock": t.danger, "Indent Raised": t.warn, "Ordered": t.primary, "Received": t.ok };
  const c = colorMap[stage] || t.textMuted;
  return <span style={{ fontSize: 11.5, fontWeight: 700, color: c, background: c + "20", padding: "3px 9px", borderRadius: 999 }}>{stage}</span>;
}

// ---------- Transactions ----------
function Transactions({ t, receipts, issues, itemName }) {
  const rows = [
    ...receipts.map((r) => ({ ...r, type: "Receipt (In)" })),
    ...issues.map((r) => ({ ...r, type: "Issue (Out)" })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div>
      <h1 className="sg" style={{ fontSize: 22, marginBottom: 2 }}>Stock Transaction Log</h1>
      <p style={{ color: t.textMuted, fontSize: 13.5, marginBottom: 20 }}>Full audit trail — combined receiving and issue history.</p>
      <Card t={t} style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead><tr><Th t={t}>Type</Th><Th t={t}>Item</Th><Th t={t}>Date</Th><Th t={t}>Qty</Th><Th t={t}>Details</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.type + r.id}>
                <Td t={t}><span style={{ fontWeight: 700, color: r.type.includes("In") ? t.ok : t.danger }}>{r.type}</span></Td>
                <Td t={t}>{itemName(r.itemId)}</Td>
                <Td t={t} style={{ color: t.textMuted }}>{fmtDate(r.date)}</Td>
                <Td t={t}>{r.qty}</Td>
                <Td t={t} style={{ color: t.textMuted }}>{r.type.includes("In") ? `${r.manufacturer || "-"} · Inv# ${r.invoiceNo || "-"}` : (r.issuedTo || "-")}</Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td t={t} style={{ color: t.textMuted }} colSpan={5}>No transactions logged yet.</Td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- Categories ----------
function Categories({ t, categories, addCategory, items }) {
  const [name, setName] = useState("");
  const submit = (e) => { e.preventDefault(); if (name.trim()) { addCategory(name.trim()); setName(""); } };
  return (
    <div>
      <h1 className="sg" style={{ fontSize: 22, marginBottom: 2 }}>Categories</h1>
      <p style={{ color: t.textMuted, fontSize: 13.5, marginBottom: 20 }}>Manage item categories — add custom ones anytime.</p>

      <Card t={t} style={{ marginBottom: 20 }}>
        <form onSubmit={submit} style={{ display: "flex", gap: 10 }}>
          <Input t={t} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Consumables, PPE, Instruments…" />
          <PrimaryBtn t={t} type="submit"><Plus size={15} /> Add Category</PrimaryBtn>
        </form>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {categories.map((c) => (
          <Card key={c} t={t}>
            <div className="sg" style={{ fontWeight: 700, fontSize: 15 }}>{c}</div>
            <div style={{ color: t.textMuted, fontSize: 12.5, marginTop: 4 }}>{items.filter((i) => i.category === c).length} items</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------- Modal ----------
function Modal({ t, title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: 22, width: 560, maxWidth: "92vw", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div className="sg" style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: t.textMuted }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
