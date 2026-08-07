"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

const GENERATION_KEY = "occ-production-generation-canary-2026-08-07";
const WHATSAPP_KEY = "occ-production-whatsapp-canary-2026-08-07";

export default function ProductionVerificationPage() {
  const [result, setResult] = useState("Ready. Automation and publishing must remain disabled.");
  const [busy, setBusy] = useState(false);

  async function run(operation: "generation" | "whatsapp", key: string) {
    setBusy(true);
    setResult(`Running ${operation} verification…`);
    try {
      const { data: { session } } = await createClient().auth.getSession();
      if (!session?.access_token) throw new Error("An authenticated OCC session is required.");
      const response = await fetch("/api/v1/content-automation/production-verification", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ operation }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || `Verification failed (${response.status}).`);
      const data = payload.data || {};
      setResult(`${operation}: ${data.status}; run ${data.run_id || "not created"}`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return <main style={{ maxWidth: 760, margin: "64px auto", padding: 24, fontFamily: "system-ui" }}>
    <h1>OCC production verification</h1>
    <p>Generation is noncanonical and generation-only. WhatsApp is one fixed, idempotent test labeled “OCC TEST — DO NOT POST”. This page cannot publish or enable automation.</p>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "24px 0" }}>
      <button disabled={busy} onClick={() => run("generation", GENERATION_KEY)}>Run generation canary</button>
      <button disabled={busy} onClick={() => run("generation", GENERATION_KEY)}>Repeat idempotency canary</button>
      <button disabled={busy} onClick={() => run("whatsapp", WHATSAPP_KEY)}>Send one WhatsApp canary</button>
    </div>
    <output aria-live="polite">{result}</output>
  </main>;
}
