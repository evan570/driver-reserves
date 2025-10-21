import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
const supabase = createClient(supabaseUrl, supabaseAnon);

type Driver = {
  id: string;
  name: string;
  location: string | null;
  available_time: string | null;
  reserve_until: string | null;
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
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 10000), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("drivers").select("*");
      setDrivers(data || []);
    })();

    const sub = supabase
      .channel("drivers-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "drivers" },
        (payload) => {
          const row = payload.new as Driver;
          setDrivers((prev) => {
            const idx = prev.findIndex((d) => d.id === row.id);
            if (idx !== -1) prev[idx] = row;
            else prev.push(row);
            return [...prev];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, []);

  async function addMinutes(id: string, min: number) {
    const d = drivers.find((x) => x.id === id);
    if (!d) return;
    const now = new Date();
    const base = d.reserve_until ? new Date(d.reserve_until) : now;
    const until = new Date(Math.max(base.getTime(), now.getTime()) + min * 60000);
    await supabase.from("drivers").update({ reserve_until: until.toISOString() }).eq("id", id);
  }

  async function resetReserve(id: string) {
    await supabase.from("drivers").update({ reserve_until: null }).eq("id", id);
  }

  async function updateField(id: string, field: string, value: string) {
    await supabase.from("drivers").update({ [field]: value }).eq("id", id);
  }

  const now = new Date();

  return (
    <div style={{ padding: 30, fontFamily: 'sans-serif' }}>
      <h1>🚚 Driver Reserve Timers</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Location</th>
            <th>Available Time</th>
            <th>Reserve</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {drivers.map((d) => {
            const until = d.reserve_until ? new Date(d.reserve_until) : null;
            const msLeft = until ? until.getTime() - now.getTime() : 0;
            const active = msLeft > 0;
            return (
              <tr key={d.id} style={{ borderTop: '1px solid #ccc' }}>
                <td>{d.name}</td>
                <td>
                  <input
                    defaultValue={d.location || ''}
                    onBlur={(e) => updateField(d.id, 'location', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    defaultValue={d.available_time?.slice(0, 16) || ''}
                    onBlur={(e) => updateField(d.id, 'available_time', e.target.value)}
                  />
                </td>
                <td>{active ? fmtTimeLeft(msLeft) : '—'}</td>
                <td>
                  <button onClick={() => addMinutes(d.id, 5)}>+5m</button>{' '}
                  <button onClick={() => addMinutes(d.id, 15)}>+15m</button>{' '}
                  <button onClick={() => addMinutes(d.id, 30)}>+30m</button>{' '}
                  <button onClick={() => resetReserve(d.id)}>Reset</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
