"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { formatNaira } from "@/lib/utils";

export default function ListsClient({ initial }: { initial: any[] }) {
  const [lists, setLists] = useState(initial);
  const [name, setName] = useState("Weekly essentials");
  const [desc, setDesc] = useState("");
  const [budget, setBudget] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setMsg("");
    try {
      const response = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: desc, spendingLimit: budget }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMsg(data.error || "Could not create the list. Check the details and try again.");
        return;
      }
      setLists((current) => [data.list, ...current]);
      setMsg("List created.");
      setName("");
      setDesc("");
      setBudget("");
    } catch {
      setMsg("Could not reach Furnivo. Your list was not confirmed as created.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-6 grid gap-6 md:grid-cols-2">
      <form onSubmit={create} className="h-fit rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-bold">Create a list</h2>
        <label htmlFor="list-name" className="mt-3 block text-sm font-medium">List name</label>
        <input id="list-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-4" />
        <label htmlFor="list-description" className="mt-3 block text-sm font-medium">Description <span className="text-slate-500">(optional)</span></label>
        <input id="list-description" value={desc} onChange={(event) => setDesc(event.target.value)} maxLength={500} className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-4" />
        <label htmlFor="list-budget" className="mt-3 block text-sm font-medium">Spending limit in naira <span className="text-slate-500">(optional, whole naira; max ₦21,474,836)</span></label>
        <input id="list-budget" value={budget} onChange={(event) => setBudget(event.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" pattern="[0-9]{1,8}" maxLength={8} max="21474836" className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-4" />
        <button type="submit" disabled={saving} className="mt-4 h-11 w-full rounded-full bg-live-black font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50">{saving ? "Creating…" : "Create list"}</button>
        {msg && <p className="mt-2 text-sm text-slate-600" role="status" aria-live="polite">{msg}</p>}
        <p className="mt-3 text-xs text-slate-500">Lists are private. The owner can invite registered users by email or phone. Stock is checked per item and merchant; this is not a combined checkout.</p>
      </form>

      <section className="space-y-3" aria-labelledby="your-lists-heading">
        <h2 id="your-lists-heading" className="font-bold">Your lists ({lists.length})</h2>
        {lists.map((list: any) => (
          <Link key={list.id} href={`/lists/${list.id}`} className="block rounded-2xl border border-slate-200 bg-white p-5 hover:border-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
            <div className="font-bold">{list.name}</div>
            <div className="text-sm text-slate-500">{list.description || "—"} • {list.items?.length ?? 0} items</div>
            {list.spendingLimit ? <div className="text-xs text-slate-400">Limit {formatNaira(list.spendingLimit)}</div> : null}
          </Link>
        ))}
        {lists.length === 0 && <p className="text-sm text-slate-500">No lists yet. Create your first list, then invite members from its page.</p>}
      </section>
    </div>
  );
}
