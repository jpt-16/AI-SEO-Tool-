import { connection as requestTime } from "next/server";
import { Sidebar } from "@/components/Sidebar";
import { getConnection } from "@/lib/google";
import { getCurrentSite, listSites } from "@/lib/sites";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requestTime();
  const [sites, connection] = await Promise.all([listSites(), getConnection()]);
  const current = await getCurrentSite(sites);
  return (
    <div className="flex min-h-screen">
      <Sidebar sites={sites} current={current} connected={Boolean(connection)} />
      <main className="flex min-w-0 flex-1 flex-col gap-7 px-13 pt-11 pb-13">{children}</main>
    </div>
  );
}
