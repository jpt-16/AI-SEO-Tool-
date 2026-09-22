import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getConnection } from "@/lib/google";

export default async function Home() {
  await connection();
  redirect((await getConnection()) ? "/performance" : "/connect");
}
