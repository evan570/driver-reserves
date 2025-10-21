import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
const supabase = createClient(supabaseUrl, supabaseAnon);

/** DB types */
type Driver = {
  id: string;
  name: string;
  location: string | null;
  available_time: string | null;     // plain text
  reserve_until: string | null;      // ISO
  reserve_started_at?: string | null; // ISO (when current reserve started)
  reserve_note?: string | null;       // last/current note for the active reserve
  created_at?: string;
};

type DriverNote = {
  id: string;
  driver_id: string;
  body: string;
  created_at: string;
};

/** Helpers */
function fmtTimeLeft(msLeft: number) {
  if (msLeft <= 0) return "0:00";
  const s = Math.floor(msLeft / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

type Theme = "light" | "dark";

export default function DriverReserves() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [, setTick] = useState(0); // local ticker for countdown
  const now = new Date();

  // Theme
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    const saved = (localStorage.getItem("driver_theme") as Theme) || null;
    if (saved) setTheme(saved);
    else {
      // если у пользователя темная система — уважаем
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
        setTheme("dark");
      }
    }
  }, []);
  useEffect(() => {
    localStorage.setItem("driver_theme", theme);
  }, [theme]);
  const colors = useMemo(() => {
    const isDark = theme === "dark";
    return {
      pageBg: isDark ? "#0f172a" : "#ffffff",
      text: isDark ? "#e5e7eb" : "#111827",
      subtext: isDark ? "#94a3b8" : "#6b7280",
      panelBorder: isDark ? "#233145" : "#e5e7eb",
      headerBg: isDark ? "#111827" : "#f3f4f6",
      dangerBg: isDark ? "#3f1d1d" : "#fee2e2",
      dangerText: isDark ? "#fecaca" : "#991b1b",
      successBg: isDark ? "#06312a" : "#ecfdf5",
      successText: isDark ? "#34d399" : "#065f46",
      cardBg: isDark ? "#0b1220" : "#ffffff",
      softBg: isDark ? "#0b1220" : "#f9fafb",
      btnPrimaryBg: isDark ? "#1f2937" : "#111827",
      btnPrimaryText: "#ffffff",
      btnGhostBorder: isDark ? "#374151" : "#e5e7eb",
    };
  }, [theme]);

  // Reserve modal
  const [reserveOpen, setReserveOpen] = useState(false);
  const [reserveDriver, setReserveDriver] = useState<Driver | null>(null);
  const [reserveMinutes, setReserveMinutes] = useState<string>("15");
  const [reserveNote, setReserveNote] = useState<string>("");

  // Profile (notes) modal
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDriver, setProfileDriver] = useState<Driver | null>(null);
  const [notes, setNotes] = useState<DriverNote[]>([]);
  const [newNote, setNewNote] = useState("");

  // UI toasts
  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  /* ticking */
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 100000), 1000);
    return () => clearInterval(id);
  }, []);

  /* initial load */
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("drivers")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) setErr(error.message);
      setDrivers((data as Driver[]) ?? []);
      setLoading(false);
    })();
  }, []);

  /* realtime drivers */
  useEffect(() => {
    const ch = supabase
      .channel("drivers-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "drivers" },
        (payload) => {
          setDrivers((prev) => {
            const next = [...prev];
            if (payload.eventType === "DELETE") {
              const idx = next.findIndex((d) => d.id === (payload.old as any)?.id);
              if (idx !== -1) next.splice(idx, 1);
              return next;
            }
            const row = payload.new as Driver;
            const idx = next.findIndex((d) => d.id === row.id);
            if (idx !== -1) next[idx] = row;
            else next.push(row);
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  /* actions */
  function openReserve(d: Driver) {
    setReserveDriver(d);
    setReserveMinutes("15");
    setReserveNote("");
    setReserveOpen(true);
  }

  async function confirmReserve() {
    if (!reserveDriver) return;
    const minutes = parseInt(reserveMinutes || "15", 10);
    if (!Number.isFinite(minutes) || minutes <= 0) return;

    // compute new until time using existing until as base
    const target = drivers.find((d) => d.id === reserveDriver.id);
    if (!target) return;

    const nowLocal = new Date();
    const base = target.reserve_until ? new Date(target.reserve_until) : nowLocal;
    const until = new Date(Math.max(base.getTime(), nowLocal.getTime()) + minutes * 60_000);

    // 1) update current reserve fields on driver
    const { error } = await supabase
      .from("drivers")
      .update({
        reserve_until: until.toISOString(),
        reserve_started_at: nowLocal.toISOString(),
        reserve_note: reserveNote.trim() || null,
      })
      .eq("id", reserveDriver.id);

    if (error) {
      setErr(error.message);
      return;
    }

    // 2) add to notes history if provided
    if (reserveNote.trim()) {
      await supabase.from("driver_notes").insert({
        driver_id: reserveDriver.id,
        body: reserveNote.trim(),
      });
    }

    setReserveOpen(false);
  }

  async function resetReserve(id: string) {
    const { error } = await supabase
      .from("drivers")
      .update({ reserve_until: null, reserve_started_at: null, reserve_note: null })
      .eq("id", id);
    if (error) setErr(error.message);
  }

  async function updateField(
    id: string,
    field: "location" | "available_time",
    value: string
  ) {
    const { error } = await supabase
      .from("drivers")
      .update({ [field]: value || null })
      .eq("id", id);
    if (error) setErr(error.message);
  }

  async function openProfile(d: Driver) {
    setProfileDriver(d);
    setProfileOpen(true);
    setNewNote("");
    const { data } = await supabase
      .from("driver_notes")
      .select("*")
      .eq("driver_id", d.id)
      .order("created_at", { ascending: false })
      .limit(10);
    setNotes((data as DriverNote[]) ?? []);
  }

  async function addProfileNote() {
    if (!profileDriver || !newNote.trim()) return;
    const { data, error } = await supabase
      .from("driver_notes")
      .insert({ driver_id: profileDriver.id, body: newNote.trim() })
      .select("*")
      .single();
    if (!error && data) {
      setNotes((prev) => [data as DriverNote, ...prev].slice(0, 10));
      setNewNote("");
    }
  }

  /* copy update */
  async function copyUpdate() {
    const lines = drivers.map((d) => {
      const name = d.name?.trim() ?? "";
      const loc = (d.location ?? "").toUpperCase();
      const avail = (d.available_time ?? "").trim() || "ava now";
      const parts = [name, loc, avail].filter(Boolean);
      // "Name // LOCATION AVAILABLE"
      return `${parts[0]} // ${parts.slice(1).join(" ")}`.replace(/\s+/g, " ").trim();
    });
    const text = lines.join("\n\n");
    await navigator.clipboard.writeText(text);
    showToast("Copied update to clipboard");
  }

  return (
    <div
      style={{
        padding: 24,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        background: colors.pageBg,
        color: colors.text,
        minHeight: "100vh",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <span>🚚</span> Driver Reserve Timers
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: `1px solid ${colors.btnGhostBorder}`,
              background: colors.cardBg,
              color: colors.text,
            }}
          >
            {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>
          <button
            onClick={copyUpdate}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: `1px solid ${colors.btnGhostBorder}`,
              background: colors.btnPrimaryBg,
              color: colors.btnPrimaryText,
            }}
          >
            Copy Update
          </button>
        </div>
      </div>

      {err && (
        <div
          style={{
            background: colors.dangerBg,
            color: colors.dangerText,
            padding: 10,
            borderRadius: 8,
            marginTop: 12,
            border: `1px solid ${colors.panelBorder}`,
          }}
        >
          {err}
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          overflow: "hidden",
          borderRadius: 16,
          border: `1px solid ${colors.panelBorder}`,
          background: colors.cardBg,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: colors.headerBg }}>
            <tr>
              <th style={{ textAlign: "left", padding: 12 }}>Name</th>
              <th style={{ textAlign: "left", padding: 12 }}>Location</th>
              <th style={{ textAlign: "left", padding: 12 }}>Available Time</th>
              <th style={{ textAlign: "left", padding: 12 }}>Reserve</th>
              <th style={{ textAlign: "left", padding: 12 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} style={{ padding: 16, color: colors.subtext }}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && drivers.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 16, color: colors.subtext }}>
                  No drivers found.
                </td>
              </tr>
            )}

            {drivers.map((d) => {
              const until = d.reserve_until ? new Date(d.reserve_until) : null;
              const msLeft = until ? until.getTime() - new Date().getTime() : 0;
              const active = !!until && msLeft > 0;

              return (
                <tr key={d.id} style={{ borderTop: `1px solid ${colors.panelBorder}` }}>
                  <td style={{ padding: 12, fontWeight: 600 }}>{d.name}</td>

                  <td style={{ padding: 12 }}>
                    <input
                      defaultValue={d.location ?? ""}
                      onBlur={(e) => updateField(d.id, "location", e.target.value)}
                      placeholder="City, ST | ZIP"
                      style={{
                        width: 220,
                        padding: 8,
                        border: `1px solid ${colors.panelBorder}`,
                        borderRadius: 8,
                        background: colors.cardBg,
                        color: colors.text,
                      }}
                    />
                  </td>

                  <td style={{ padding: 12 }}>
                    <input
                      defaultValue={d.available_time ?? ""}
                      onBlur={(e) => updateField(d.id, "available_time", e.target.value)}
                      placeholder="Any text"
                      style={{
                        width: 180,
                        padding: 8,
                        border: `1px solid ${colors.panelBorder}`,
                        borderRadius: 8,
                        background: colors.cardBg,
                        color: colors.text,
                      }}
                    />
                  </td>

                  <td style={{ padding: 12 }}>
                    {active ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          background: colors.successBg,
                          color: colors.successText,
                          padding: "4px 10px",
                          borderRadius: 999,
                        }}
                      >
                        ● {fmtTimeLeft(msLeft)}
                      </span>
                    ) : (
                      <span style={{ color: colors.subtext }}>—</span>
                    )}
                  </td>

                  <td style={{ padding: 12 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <button
                        onClick={() => openReserve(d)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 10,
                          border: `1px solid ${colors.btnGhostBorder}`,
                          background: colors.btnPrimaryBg,
                          color: colors.btnPrimaryText,
                        }}
                      >
                        Reserve…
                      </button>
                      <button
                        onClick={() => openProfile(d)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 10,
                          border: `1px solid ${colors.btnGhostBorder}`,
                          background: colors.cardBg,
                          color: colors.text,
                        }}
                      >
                        Profile
                      </button>
                      <button
                        onClick={() => resetReserve(d.id)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 10,
                          border: `1px solid ${colors.btnGhostBorder}`,
                          background: "#dc2626",
                          color: "#ffffff",
                        }}
                      >
                        Reset
                      </button>
                    </div>

                    {/* Current reserve note */}
                    {active && d.reserve_note ? (
                      <div
                        style={{
                          marginTop: 8,
                          background: colors.softBg,
                          border: `1px solid ${colors.panelBorder}`,
                          borderRadius: 8,
                          padding: "8px 10px",
                          maxWidth: 420,
                        }}
                      >
                        <div style={{ fontSize: 12, color: colors.subtext, marginBottom: 4 }}>
                          Note for this reserve
                          {d.reserve_started_at
                            ? ` • ${new Date(d.reserve_started_at).toLocaleString()}`
                            : ""}
                        </div>
                        <div>{d.reserve_note}</div>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            right: 16,
            background: colors.cardBg,
            border: `1px solid ${colors.panelBorder}`,
            color: colors.text,
            borderRadius: 10,
            padding: "8px 12px",
            boxShadow: "0 8px 20px rgba(0,0,0,0.15)",
          }}
        >
          {toast}
        </div>
      )}

      {/* Reserve modal */}
      {reserveOpen && reserveDriver && (
        <div style={overlayStyle}>
          <div style={{ ...modalStyle, background: colors.cardBg, color: colors.text, border: `1px solid ${colors.panelBorder}` }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              Reserve — {reserveDriver.name}
            </h3>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: colors.subtext }}>Minutes</label>
              <input
                type="number"
                min={1}
                value={reserveMinutes}
                onChange={(e) => setReserveMinutes(e.target.value)}
                style={{
                  width: "100%",
                  padding: 8,
                  border: `1px solid ${colors.panelBorder}`,
                  borderRadius: 8,
                  background: colors.cardBg,
                  color: colors.text,
                }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: colors.subtext }}>Note (optional)</label>
              <textarea
                rows={4}
                placeholder="Anything to remember…"
                value={reserveNote}
                onChange={(e) => setReserveNote(e.target.value)}
                style={{
                  width: "100%",
                  padding: 8,
                  border: `1px solid ${colors.panelBorder}`,
                  borderRadius: 8,
                  background: colors.cardBg,
                  color: colors.text,
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button
                onClick={() => setReserveOpen(false)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: `1px solid ${colors.btnGhostBorder}`,
                  background: colors.cardBg,
                  color: colors.text,
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmReserve}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: `1px solid ${colors.btnGhostBorder}`,
                  background: colors.btnPrimaryBg,
                  color: colors.btnPrimaryText,
                }}
              >
                Start
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Profile (notes) modal */}
      {profileOpen && profileDriver && (
        <div style={overlayStyle}>
          <div style={{ ...modalStyle, background: colors.cardBg, color: colors.text, border: `1px solid ${colors.panelBorder}` }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              Profile — {profileDriver.name}
            </h3>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: colors.subtext }}>Add note</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Type a note…"
                  style={{
                    flex: 1,
                    padding: 8,
                    border: `1px solid ${colors.panelBorder}`,
                    borderRadius: 8,
                    background: colors.cardBg,
                    color: colors.text,
                  }}
                />
                <button
                  onClick={addProfileNote}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: `1px solid ${colors.btnGhostBorder}`,
                    background: colors.btnPrimaryBg,
                    color: colors.btnPrimaryText,
                  }}
                >
                  Save
                </button>
              </div>
            </div>

            <div
              style={{
                marginTop: 16,
                maxHeight: 280,
                overflowY: "auto",
                border: `1px solid ${colors.panelBorder}`,
                borderRadius: 8,
              }}
            >
              {notes.length === 0 ? (
                <div style={{ padding: 12, color: colors.subtext }}>No notes yet.</div>
              ) : (
                notes.map((n) => (
                  <div key={n.id} style={{ padding: 12, borderTop: `1px solid ${colors.panelBorder}` }}>
                    <div style={{ fontSize: 12, color: colors.subtext, marginBottom: 4 }}>
                      {new Date(n.created_at).toLocaleString()}
                    </div>
                    <div>{n.body}</div>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button
                onClick={() => setProfileOpen(false)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: `1px solid ${colors.btnGhostBorder}`,
                  background: colors.btnPrimaryBg,
                  color: colors.btnPrimaryText,
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Styles */
const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  zIndex: 50,
};

const modalStyle: React.CSSProperties = {
  width: 520,
  maxWidth: "100%",
  background: "white",
  borderRadius: 16,
  padding: 16,
  boxShadow: "0 10px 25px rgba(0,0,0,0.12)",
};
