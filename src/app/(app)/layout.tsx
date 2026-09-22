import { connection as requestTime } from "next/server";
import { Sidebar } from "@/components/Sidebar";
import { getConnection } from "@/lib/google";
import { getCurrentSite, listSites } from "@/lib/sites";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requestTime();
  const [sites, connection] = await Promise.all([listSites(), getConnection()]);
  const current = await getCurrentSite(sites);
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar sites={sites} current={current} connected={Boolean(connection)} />
      <main className="flex min-w-0 flex-1 flex-col gap-5 px-4 pt-6 pb-10 sm:gap-7 sm:px-8 sm:pt-8 lg:px-13 lg:pt-11 lg:pb-13">
        {children}
      </main>
    </div>
  );
}
