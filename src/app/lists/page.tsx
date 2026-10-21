import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Header } from "@/components/Header";
import { redirect } from "next/navigation";
import ListsClient from "./ListsClient";
export const dynamic = "force-dynamic";

export default async function ListsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/lists");
  const lists = await prisma.shoppingList.findMany({
    where: { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
    select: {
      id: true,
      name: true,
      description: true,
      spendingLimit: true,
      items: { select: { id: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="min-h-screen">
      <Header user={user} />
      <main className="mx-auto max-w-[900px] px-4 py-6">
        <h1 className="font-black text-2xl">Shopping Lists</h1>
        <p className="text-sm text-slate-500">Personal and invited shared lists with availability checks. Add any product, set a budget, and invite registered users.</p>
        <ListsClient initial={lists} />
      </main>
    </div>
  );
}
