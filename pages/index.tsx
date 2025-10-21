import React, { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
const supabase = createClient(supabaseUrl, supabaseAnon);

type Driver = {
  id: string;
  name: string;
  location: string | null;
  available_time: string | null;   // теперь текст
  reserve_until: string | null;    // ISO
  created_at?: string;
};

type DriverNote = {
  id: string;
  driver_id: string;
  body: string;
  created_at: string;
};

function fmtTimeLeft(msLeft: number) {
  if (msLeft <= 0) return "0:00";
  const s = Math.floor(msLeft / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

export default function DriverReserves() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // reserve modal state
  const [reserveOpen, setReserveOpen] = useState(false);
  const [reserveDriver, setReserveDriver] = useState<Driver | null>(null);
  const [reserveMinutes, setReserveMinutes] = useState<string>("15");
  const [reserveNote, setReserveNote] = useState<string>("");

  // profile (notes) modal
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDriver, setProfileDriver] = useState<Driver | null>(null);
  const [notes, setNotes] = useState<DriverNote[]>([]);
  const [newNote, setNewNote] = useState("");

  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 100000), 1000);
    return () => clearInterval(id);
  }, []);

  // initial load
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

  // realtime for drivers
  useEffect(() => {
    const ch = supabase
      .channel("drivers-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, (payload) => {
        setDrivers((prev) => {
          const next = [...prev];
          if (payload.eventType === "DELETE") {
            const idx = next.findIndex((d) => d.id === (payload.old as any)?.id);
            if (idx !== -1) next.splice(idx, 1);
            return next;
          }
          const row = payload.new as Driver;
          const idx = next.findIndex((d) => d.id === row.id);
          if (idx !== -1) next[idx] = row; else next.push(row);
          return next;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // open reserve modal
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

    await addMinutes(reserveDriver.id, minutes);

    if (reserveNote.trim()) {
      await supabase.from("driver_notes").insert({
        driver_id: reserveDriver.id,
        body: reserveNote.trim(),
      });
    }
    setReserveOpen(false);
  }

  async function addMinutes(id: string, minutes: number) {
    const target = drivers.find((d) => d.id === id);
    if (!target) return;
    const now = new Date();
    const base = target.reserve_until ? new Date(target.reserve_until) : now;
    const until = new Date(Math.max(base.getTime(), now.getTime()) + minutes * 60_000);
    const { error } = await supabase.from("drivers").update({ reserve_until: until.toISOString() }).eq("id", id);
    if (error) setErr(error.message);
  }

  async function resetReserve(id: string) {
    const { error } = await supabase.from("drivers").update({ reserve_until: null }).eq("id", id);
    if (error) setErr(error.message);
  }

  async function updateField(id: string, field: "location" | "available_time", value: string) {
    const { error } = await supabase.from("drivers").update({ [field]: value || null }).eq("id", id);
    if (error) setErr(error.message);
  }

  // open profile modal (load last 10 notes)
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

  const now = new Date();

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
        <span>🚚</span> Driver Reserve Timers
      </h1>

      {err && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: 10, borderRadius: 8, marginTop: 12 }}>
          {err}
        </div>
      )}

      <div style={{ marginTop: 16, overflow: "hidden", borderRadius: 16, border: "1px solid #e5e7eb" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f3f4f6" }}>
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
              <tr><td colSpan={5} style={{ padding: 16, color: "#6b7280" }}>Loading…</td></tr>
            )}
            {!loading && drivers.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 16, color: "#6b7280" }}>No drivers found.</td></tr>
            )}
            {drivers.map((d) => {
              const until = d.reserve_until ? new Date(d.reserve_until) : null;
              const msLeft = until ? until.getTime() - now.getTime() : 0;
              const active = !!until && msLeft > 0;
              return (
                <tr key={d.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td style={{ padding: 12, fontWeight: 600 }}>{d.name}</td>
                  <td style={{ padding: 12 }}>
                    <input
                      defaultValue={d.location ?? ""}
                      onBlur={(e) => updateField(d.id, "location", e.target.value)}
                      placeholder="City, ST | ZIP"
                      style={{ width: 220, padding: 8, border: "1px solid #e5e7eb", borderRadius: 8 }}
                    />
                  </td>
                  <td style={{ padding: 12 }}>
                    <input
                      defaultValue={d.available_time ?? ""}
                      onBlur={(e) => updateField(d.id, "available_time", e.target.value)}
                      placeholder="Any text"
                      style={{ width: 180, padding: 8, border: "1px solid #e5e7eb", borderRadius: 8 }}
                    />
                  </td>
                  <td style={{ padding: 12 }}>
                    {active ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#ecfdf5", color: "#065f46", padding: "4px 10px", borderRadius: 999 }}>
                        ● {fmtTimeLeft(msLeft)}
                      </span>
                    ) : (
                      <span style={{ color: "#9ca3af" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: 12 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <button
                        onClick={() => openReserve(d)}
                        style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#111827", color: "white" }}
                      >
                        Reserve…
                      </button>
                      <button
                        onClick={() => openProfile(d)}
                        style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #e5e7eb" }}
                      >
                        Profile
                      </button>
                      <button
                        onClick={() => resetReserve(d.id)}
                        style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#dc2626", color: "white" }}
                      >
                        Reset
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Reserve modal */}
      {reserveOpen && reserveDriver && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Reserve — {reserveDriver.name}</h3>
            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: "#6b7280" }}>Minutes</label>
              <input
                type="number"
                min={1}
                value={reserveMinutes}
                onChange={(e) => setReserveMinutes(e.target.value)}
                style={{ width: "100%", padding: 8, border: "1px solid #e5e7eb", borderRadius: 8 }}
              />
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: "#6b7280" }}>Note (optional)</label>
              <textarea
                rows={4}
                placeholder="Anything to remember…"
                value={reserveNote}
                onChange={(e) => setReserveNote(e.target.value)}
                style={{ width: "100%", padding: 8, border: "1px solid #e5e7eb", borderRadius: 8 }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={() => setReserveOpen(false)} style={btnGhost}>Cancel</button>
              <button onClick={confirmReserve} style={btnPrimary}>Start</button>
            </div>
          </div>
        </div>
      )}

      {/* Profile (notes) modal */}
      {profileOpen && profileDriver && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Profile — {profileDriver.name}</h3>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: "#6b7280" }}>Add note</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Type a note…"
                  style={{ flex: 1, padding: 8, border: "1px solid #e5e7eb", borderRadius: 8 }}
                />
                <button onClick={addProfileNote} style={btnPrimary}>Save</button>
              </div>
            </div>

            <div style={{ marginTop: 16, maxHeight: 280, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
              {notes.length === 0 ? (
                <div style={{ padding: 12, color: "#6b7280" }}>No notes yet.</div>
              ) : (
                notes.map((n) => (
                  <div key={n.id} style={{ padding: 12, borderTop: "1px solid #f3f4f6" }}>
                    <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                      {new Date(n.created_at).toLocaleString()}
                    </div>
                    <div>{n.body}</div>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={() => setProfileOpen(false)} style={btnPrimary}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Inline styles for modal/buttons */
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

const btnPrimary: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #111827",
  background: "#111827",
  color: "white",
};

const btnGhost: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "white",
};
