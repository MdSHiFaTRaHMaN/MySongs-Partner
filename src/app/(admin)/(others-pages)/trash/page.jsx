import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TrashPage({ searchParams }) {
  const params = await searchParams;
  const queryString = params ? new URLSearchParams(params).toString() : "";
  redirect(`/trash/music${queryString ? `?${queryString}` : ""}`);
}
