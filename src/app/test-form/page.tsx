"use client"

import { useState, useEffect } from "react"
import Script from "next/script"

export default function TestForm() {
    const [status, setStatus] = useState("idle")
    const [logs, setLogs] = useState<string[]>([])

    const addLog = (msg: string) => setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setStatus("sending")
        addLog("Submitting form...")

        const formData = new FormData(e.target as HTMLFormElement)

        // Get Session ID from HaloTrack
        const sessionId = (window as any).HaloTrack?.getSessionId()
        addLog(`Session ID found: ${sessionId || "NONE"}`)

        try {
            const res = await fetch("/api/webhook/lead", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    lead_id: `test_${Date.now()}`,
                    source: "test_form_page",
                    email: formData.get("email"),
                    phone: formData.get("phone"),
                    name: "Test Lead",
                    // Send session_id explicitly
                    session_id: sessionId,
                    halo_session_id: sessionId,
                    consent_given: true
                })
            })

            const data = await res.json()
            addLog(`Server Response: ${JSON.stringify(data, null, 2)}`)

            if (data.success) {
                setStatus("success")
                if (data.forwarded?.google) addLog("✅ Sent to Google (Server-Side)")
                else addLog("❌ Google Send FAILED")

                if (data.forwarded?.facebook) addLog("✅ Sent to Facebook (Server-Side)")
                else addLog("❌ Facebook Send FAILED")
            } else {
                setStatus("error")
            }

        } catch (err) {
            addLog(`Error: ${err}`)
            setStatus("error")
        }
    }

    return (
        <div className="p-8 max-w-xl mx-auto font-sans">
            <h1 className="text-2xl font-bold mb-4">Tracking Debugger</h1>

            <div className="bg-gray-100 p-4 rounded mb-6 text-sm">
                <p><strong>Instructions:</strong></p>
                <ol className="list-decimal ml-4">
                    <li>Start GTag/Pixel Helper extensions</li>
                    <li>Submit this form</li>
                    <li>Check the logs below</li>
                </ol>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 border p-6 rounded shadow">
                <div>
                    <label className="block text-sm font-medium">Test Email</label>
                    <input name="email" type="email" defaultValue="test@example.com" className="border p-2 w-full rounded" />
                </div>
                <div>
                    <label className="block text-sm font-medium">Test Phone</label>
                    <input name="phone" type="tel" defaultValue="+420123456789" className="border p-2 w-full rounded" />
                </div>
                <button
                    type="submit"
                    disabled={status === "sending"}
                    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                    {status === "sending" ? "Sending..." : "Send Test Lead"}
                </button>
            </form>

            <div className="mt-8">
                <h3 className="font-bold mb-2">Debug Logs:</h3>
                <pre className="bg-black text-green-400 p-4 rounded text-xs overflow-auto h-64">
                    {logs.length === 0 ? "Waiting..." : logs.join("\n")}
                </pre>
            </div>

            <Script src="/t.js" />
        </div>
    )
}
