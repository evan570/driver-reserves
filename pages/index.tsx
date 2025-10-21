import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

// 🔑 ENV (Vercel → Project Settings → Environment Variables)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
const supabase = createClient(supabaseUrl, supabaseAnon);

type Driver = {
  id: string;
  name: string;
  location: string | null;
  available_time: string | null; // ISO
  reserve_until: string | null;  // ISO
  created_at?: string;
};

function fmtTimeLeft(msLeft: number) {
  if (msLeft <= 0) return "0:00";
  const totalSeconds = Math.floor(msLeft / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function DriverReserves() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // local ticking for countdown label
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

  // realtime sync
  useEffect(() => {
    const channel = supabase
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
            if (idx !== -1) next[idx] = row; else next.push(row);
            return next;
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function reservePrompt(id: string) {
    const raw = window.prompt("Minutes to reserve (default 15):", "15");
    if (raw === null) return;
    const minutes = parseInt(raw || "15", 10);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    await addMinutes(id, minutes);
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
    // now "available_time" is a plain text column; save as-is
    const patch: any = { [field]: value || null };
    const { error } = await supabase.from("drivers").update(patch).eq("id", id);
    if (error) setErr(error.message);
  };
    if (field === "available_time" && value) {
      try { patch[field] = new Date(value.replace(" ", "T")).toISOString(); }
      catch { patch[field] = value; }
    } else {
      patch[field] = value || null;
    }
    const { error } = await supabase.from("drivers").update(patch).eq("id", id);
    if (error) setErr(error.message);
  }

  const now = new Date();

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>🚚</span> Driver Reserve Timers
      </h1>

      {err && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 8, marginTop: 12 }}>
          {err}
        </div>
      )}

      <div style={{ marginTop: 16, overflow: 'hidden', borderRadius: 16, border: '1px solid #e5e7eb' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f3f4f6' }}>
            <tr>
              <th style={{ textAlign: 'left', padding: 12 }}>Name</th>
              <th style={{ textAlign: 'left', padding: 12 }}>Location</th>
              <th style={{ textAlign: 'left', padding: 12 }}>Available Time</th>
              <th style={{ textAlign: 'left', padding: 12 }}>Reserve</th>
              <th style={{ textAlign: 'left', padding: 12 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} style={{ padding: 16, color: '#6b7280' }}>Loading…</td></tr>
            )}
            {!loading && drivers.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 16, color: '#6b7280' }}>No drivers found. Add rows in Supabase → Table Editor → drivers.</td></tr>
            )}
            {drivers.map((d) => {
              const until = d.reserve_until ? new Date(d.reserve_until) : null;
              const msLeft = until ? until.getTime() - now.getTime() : 0;
              const active = !!until && msLeft > 0;
              return (
                <tr key={d.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 12, fontWeight: 600 }}>{d.name}</td>
                  <td style={{ padding: 12 }}>
                    <input
                      defaultValue={d.location ?? ''}
                      onBlur={(e) => updateField(d.id, 'location', e.target.value)}
                      placeholder="City, ST | ZIP"
                      style={{ width: 220, padding: 8, border: '1px solid #e5e7eb', borderRadius: 8 }}
                    />
                  </td>
                  <td style={{ padding: 12 }}>
                    <input
                      defaultValue={d.available_time ? d.available_time.slice(0, 16).replace('T', ' ') : ''}
                      onBlur={(e) => updateField(d.id, 'available_time', e.target.value)}
                      placeholder="YYYY-MM-DD HH:mm"
                      style={{ width: 180, padding: 8, border: '1px solid #e5e7eb', borderRadius: 8 }}
                    />
                  </td>
                  <td style={{ padding: 12 }}>
                    {active ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#ecfdf5', color: '#065f46', padding: '4px 10px', borderRadius: 999 }}>
                        ● {fmtTimeLeft(msLeft)}
                      </span>
                    ) : (
                      <span style={{ color: '#9ca3af' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: 12 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button onClick={() => reservePrompt(d.id)} style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#111827', color: 'white' }}>Reserve…</button>
                      <button onClick={() => resetReserve(d.id)} style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#dc2626', color: 'white' }}>Reset</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/*
If you still don't see drivers:
1) Ensure URL & anon key match this project.
2) Run these policies (SQL Editor):

alter table public.drivers enable row level security;
create policy if not exists "drivers anon read" on public.drivers for select using (true);
create policy if not exists "drivers anon write" on public.drivers for update using (true);

3) Seed 4 drivers if table is empty:
insert into public.drivers (name) values ('Driver 1'),('Driver 2'),('Driver 3'),('Driver 4');
*/
